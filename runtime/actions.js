/**
 * Action runner for `rn-a11y-tree run --script`. Runs inside the bundle
 * after the initial render, outside any Fantom task (each action runs the
 * work loop itself).
 *
 * Host methods (NativeFantom, added by react-native-a11y-tree's host):
 *   getA11yTree(surfaceId, includeDebugProps, includeMountedProps) -> string (required)
 *   hitTest(surfaceId, x, y) -> string ('{"tag","type","path"}' | 'null')
 *   enqueueNativeEventByTag(surfaceId, tag, type, payload?, category?, isUnique?)
 *   enqueueScrollEventByTag(surfaceId, tag, {x, y, zoomScale?})
 *   setTextInputTextByTag(surfaceId, tag, text)
 * All but getA11yTree are optional: without them the runner falls back to
 * a JS hit test over the getA11yTree boxes and to Fantom's
 * `enqueueNativeEvent` / `enqueueScrollEvent` on the element found by tag in
 * `root.document`. Each step reports which path it used (`via`).
 */

import {readA11yTree} from './hostConfig';
import {settle} from './settle';
import {
  center,
  findEntry,
  hitTestEntries,
  indexTree,
  isWithin,
} from './tree-index';

const Fantom = require('./fantom/index');
const NativeFantom = require('./fantom/specs/NativeFantom').default;
const {NativeEventCategory} = require('./fantom/specs/NativeFantom');

const LONG_PRESS_MS = 600;
// The host's UI tick length (TesterAppDelegate::produceFramesForDuration
// steps its clock by 16.333 ms). Using the same length gives exactly one UI
// tick per slice.
const FRAME_MS = 16.333;
const SWITCH_TYPES = new Set(['AndroidSwitch', 'Switch']);

function has(name) {
  return typeof NativeFantom[name] === 'function';
}

/**
 * Creates a runner bound to a rendered root. `runStep(action, index)` runs
 * one action and returns `{step, snapshot}` (`snapshot` is the raw tree for
 * `snapshot` actions). Installs the Fantom timer mock until `dispose()`.
 */
export function createRunner({root, tapMode}) {
  const surfaceId = root.getRootTag();
  const timers = Fantom.installTimerMock();
  let timestamp = 1;

  const fallbacks = new Set();

  /**
   * Reads the typed tree. ScrollView scroll positions live in the
   * ScrollView's state, not in its props; if the host reports no (or a
   * different) `contentOffset`, take it from the state through the DOM API
   * (`element.scrollLeft/scrollTop`, which reads the ShadowTree state).
   */
  function readTree() {
    const tree = JSON.parse(readA11yTree(surfaceId));
    const visit = node => {
      if (/ScrollView$/.test(node.type) && node.tag != null) {
        const element = findElementByTagOrNull(node.tag);
        if (element != null) {
          const x = element.scrollLeft;
          const y = element.scrollTop;
          const reported = node.contentOffset ?? {x: 0, y: 0};
          if (reported.x !== x || reported.y !== y) {
            node.contentOffset = {x, y};
            fallbacks.add('scrollOffset: dom');
          }
        }
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
    return tree;
  }

  function findElementByTagOrNull(tag) {
    try {
      return findElementByTag(tag);
    } catch {
      return null;
    }
  }

  // --- tag -> element (JS fallback for event dispatch) ---------------------

  function findElementByTag(tag) {
    const stack = [root.document.documentElement];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node == null) continue;
      if (node.__nativeTag === tag) return node;
      const children = node.children;
      if (children != null) {
        for (let i = 0; i < children.length; i++) stack.push(children[i]);
      }
    }
    throw new Error(`No element with tag ${tag} in the document`);
  }

  // --- dispatch ------------------------------------------------------------

  const via = {hitTest: null, events: null};

  function enqueueEvent(tag, type, payload, category) {
    if (has('enqueueNativeEventByTag')) {
      via.events = 'native';
      NativeFantom.enqueueNativeEventByTag(surfaceId, tag, type, payload, category);
    } else {
      via.events = 'js';
      fallbacks.add('events: js');
      Fantom.enqueueNativeEvent(findElementByTag(tag), type, payload, {category});
    }
  }

  /** Sends events as one UI-thread batch, then runs the work loop. */
  function dispatch(tag, events, sent) {
    for (const [type, payload, category] of events) {
      enqueueEvent(tag, type, payload, category);
      sent.push(type);
    }
    NativeFantom.flushEventQueue();
    Fantom.runWorkLoop();
  }

  function hitTest(entries, x, y) {
    if (has('hitTest')) {
      via.hitTest = 'native';
      const result = JSON.parse(NativeFantom.hitTest(surfaceId, x, y));
      if (result == null) return null;
      const entry = entries.find(e => e.tag === result.tag) ?? {
        tag: result.tag,
        type: result.type,
        ref: null,
        testID: null,
        box: null,
        parent: null,
      };
      return {...entry, viaHitSlop: result.viaHitSlop === true, path: result.path};
    }
    via.hitTest = 'js';
    fallbacks.add('hitTest: js');
    return hitTestEntries(entries, x, y);
  }

  // Touch payloads in the shape the native worker verified with Pressable
  // (tests/FantomInteraction-itest.js): no top-level target/identifier.
  function touchPoint(tag, point, box) {
    return {
      pageX: point.x,
      pageY: point.y,
      locationX: box ? point.x - box.x : 0,
      locationY: box ? point.y - box.y : 0,
      screenX: point.x,
      screenY: point.y,
      identifier: 0,
      target: tag,
      timestamp: timestamp++,
      force: 1,
    };
  }

  function touchStartPayload(tag, point, box) {
    const t = touchPoint(tag, point, box);
    return {touches: [t], changedTouches: [t], targetTouches: [t]};
  }

  function touchMovePayload(tag, point, box) {
    const t = touchPoint(tag, point, box);
    return {touches: [t], changedTouches: [t], targetTouches: [t]};
  }

  function touchEndPayload(tag, point, box) {
    const t = touchPoint(tag, point, box);
    return {touches: [], changedTouches: [t], targetTouches: []};
  }

  // --- targets -------------------------------------------------------------

  function describe(entry) {
    if (entry == null) return null;
    const result = {
      tag: entry.tag,
      ref: entry.ref,
      testID: entry.testID,
      type: entry.type,
      box: entry.box,
    };
    if (entry.viaHitSlop !== undefined) result.viaHitSlop = entry.viaHitSlop;
    return result;
  }

  /** Resolves the target and the hit node for tap-like actions. */
  function locate(spec) {
    const entries = indexTree(readTree());
    let target = null;
    let point;
    if (spec.x != null && spec.y != null) {
      point = {x: spec.x, y: spec.y};
    } else {
      target = findEntry(entries, spec);
      if (target == null) {
        throw new Error(`Target not found: ${JSON.stringify(spec)}`);
      }
      // Aim at where the target is drawn (transforms move it; the host
      // hit test honors transforms).
      point = center(target.visualBox ?? target.box);
    }
    const hit = hitTest(entries, point.x, point.y);
    if (target == null) target = hit;
    const warnings = [];
    if (hit == null) {
      warnings.push(`Nothing is hittable at (${point.x}, ${point.y})`);
    } else if (!isWithin(hit, target)) {
      warnings.push(
        `Target is covered: the hit node at (${point.x}, ${point.y}) is ${hit.type} ${hit.ref ?? ''}(tag ${hit.tag}), not inside the target`,
      );
    }
    return {entries, target, hit, point, warnings};
  }

  /** The Switch the hit lands in (the hit node or an ancestor), if any. */
  function switchFor(entry) {
    for (let e = entry; e != null; e = e.parent) {
      if (SWITCH_TYPES.has(e.type)) return e;
    }
    return null;
  }

  // --- actions -------------------------------------------------------------

  // --- pointer input for react-native-gesture-handler ----------------------
  //
  // When the app uses react-native-gesture-handler, runtime/gh/ installs
  // globalThis.__rnA11yGestureHandler. Every pointer sample of a gesture is
  // also fed to it (DOWN / MOVE / UP with `time` from the mocked clock), for
  // the handlers attached to the hit view and its ancestors.

  let clock = 1000;

  function tagPath(hit) {
    if (Array.isArray(hit.path)) return hit.path;
    const tags = [];
    for (let e = hit; e != null; e = e.parent) {
      if (e.tag != null) tags.unshift(e.tag);
    }
    return tags;
  }

  function ghFeed(kind, pointerId, point, path, step) {
    const gh = globalThis.__rnA11yGestureHandler;
    if (gh == null) return;
    let result = null;
    Fantom.runTask(() => {
      result = gh.feed(kind, {x: point.x, y: point.y, pointerId, time: clock}, path);
    });
    // v3 handlers report through Fabric events on the detector.
    NativeFantom.flushEventQueue();
    Fantom.runWorkLoop();
    if (result != null && result.reanimatedEvents > 0) {
      // Reanimated applies worklet updates on the next UI tick; run one
      // without moving the clock noticeably (1 µs).
      NativeFantom.produceFramesForDuration(0.001);
      Fantom.flushAllNativeEvents();
    }
    if (result != null && result.handlers > 0) {
      step.gestureHandlers = Math.max(step.gestureHandlers ?? 0, result.handlers);
      const name = `gh:${kind}`;
      if (step.events[step.events.length - 1] !== name) step.events.push(name);
    }
  }

  function tap(spec, step, {longPress = false} = {}) {
    const {target, hit, point, warnings} = locate(spec);
    step.target = describe(target);
    step.hit = describe(hit);
    if (warnings.length > 0) step.warnings = warnings;
    if (hit == null) {
      throw new Error(warnings[0]);
    }

    const switchEntry = !longPress ? switchFor(hit) : null;
    if (switchEntry != null) {
      // A Switch is not a Pressable: the native side toggles it and sends
      // `change` with the new value (see Switch-itest.js).
      dispatch(switchEntry.tag, [['change', {value: !(switchEntry.node.value === true)}]], step.events);
      return;
    }

    if (tapMode === 'touch' || tapMode === 'both') {
      const path = tagPath(hit);
      const start = touchStartPayload(hit.tag, point, hit.box);
      dispatch(hit.tag, [['touchStart', start, NativeEventCategory.ContinuousStart]], step.events);
      ghFeed('down', 0, point, path, step);
      if (longPress) {
        advance(LONG_PRESS_MS);
        step.events.push(`wait ${LONG_PRESS_MS}ms`);
      }
      const end = touchEndPayload(hit.tag, point, hit.box);
      dispatch(hit.tag, [['touchEnd', end, NativeEventCategory.ContinuousEnd]], step.events);
      ghFeed('up', 0, point, path, step);
    }
    if (!longPress && (tapMode === 'click' || tapMode === 'both')) {
      // `click` does not bubble from a child (e.g. the label Paragraph) to
      // the Pressable in this host, so send it to the target when the hit is
      // inside it. Coordinate taps have no target; they use the hit node.
      const clickTag = target != null && isWithin(hit, target) ? target.tag : hit.tag;
      dispatch(clickTag, [['click', {}]], step.events);
    }
  }

  /** One finger from the start point by (dx, dy) in `steps` moves over `durationMs`. */
  function pan(spec, step) {
    const {target, hit, point, warnings} = locate(spec);
    step.target = describe(target);
    step.hit = describe(hit);
    if (warnings.length > 0) step.warnings = warnings;
    if (hit == null) throw new Error(warnings[0]);
    const steps = spec.steps ?? 10;
    const durationMs = spec.durationMs ?? 200;
    const dx = spec.dx ?? 0;
    const dy = spec.dy ?? 0;
    const path = tagPath(hit);

    dispatch(hit.tag, [['touchStart', touchStartPayload(hit.tag, point, hit.box), NativeEventCategory.ContinuousStart]], step.events);
    ghFeed('down', 0, point, path, step);
    let current = point;
    // Moves are summarized as "touchMove xN" / "gh:move xN".
    const moveStep = {events: []};
    for (let i = 1; i <= steps; i++) {
      advance(durationMs / steps);
      current = {x: point.x + (dx * i) / steps, y: point.y + (dy * i) / steps};
      dispatch(hit.tag, [['touchMove', touchMovePayload(hit.tag, current, hit.box), NativeEventCategory.Continuous]], moveStep.events);
      ghFeed('move', 0, current, path, moveStep);
    }
    step.events.push(`touchMove x${steps}`);
    if (moveStep.gestureHandlers != null) {
      step.events.push(`gh:move x${steps}`);
      step.gestureHandlers = Math.max(step.gestureHandlers ?? 0, moveStep.gestureHandlers);
    }
    dispatch(hit.tag, [['touchEnd', touchEndPayload(hit.tag, current, hit.box), NativeEventCategory.ContinuousEnd]], step.events);
    ghFeed('up', 0, current, path, step);
  }

  /**
   * Two fingers placed horizontally around the target's center, moved apart
   * (scale > 1) or together (scale < 1). Only react-native-gesture-handler
   * gets these pointers (no multi-touch responder events yet).
   */
  function pinch(spec, step) {
    const {target, hit, point, warnings} = locate(spec);
    step.target = describe(target);
    step.hit = describe(hit);
    if (warnings.length > 0) step.warnings = warnings;
    if (hit == null) throw new Error(warnings[0]);
    const steps = spec.steps ?? 10;
    const durationMs = spec.durationMs ?? 300;
    const box = target?.box ?? hit.box ?? {width: 100, height: 100};
    const d0 = Math.max(10, Math.min(box.width, box.height) / 4);
    const d1 = d0 * spec.scale;
    const path = tagPath(hit);
    const at = d => [
      {x: point.x - d, y: point.y},
      {x: point.x + d, y: point.y},
    ];

    let [a, b] = at(d0);
    ghFeed('down', 0, a, path, step);
    ghFeed('down', 1, b, path, step);
    for (let i = 1; i <= steps; i++) {
      advance(durationMs / steps);
      [a, b] = at(d0 + ((d1 - d0) * i) / steps);
      ghFeed('move', 0, a, path, step);
      ghFeed('move', 1, b, path, step);
    }
    ghFeed('up', 1, b, path, step);
    ghFeed('up', 0, a, path, step);
    if (globalThis.__rnA11yGestureHandler == null) {
      (step.warnings ??= []).push('pinch needs react-native-gesture-handler in the app; no events were sent');
    }
  }

  function type(spec, step) {
    const entries = indexTree(readTree());
    const target = findEntry(entries, spec);
    if (target == null) {
      throw new Error(`Target not found: ${JSON.stringify(spec)}`);
    }
    step.target = describe(target);
    step.hit = describe(target);
    const tag = target.tag;
    const warnings = [];

    dispatch(tag, [['focus', {target: tag}]], step.events);
    let text = typeof target.node.text === 'string' ? target.node.text : '';
    let eventCount = 0;
    for (const key of Array.from(spec.text)) {
      text += key;
      eventCount++;
      dispatch(tag, [['keyPress', {key, target: tag}]], step.events);
      // Update the input's ShadowTree state first (as the native side does
      // on a real device), then tell JS with `change`.
      if (has('setTextInputTextByTag')) {
        NativeFantom.setTextInputTextByTag(surfaceId, tag, text);
      } else if (warnings.length === 0) {
        fallbacks.add('text: not reflected');
        warnings.push('Host has no setTextInputTextByTag: the ShadowTree text of the input is not updated');
      }
      dispatch(tag, [['change', {text, eventCount, target: tag}]], step.events);
    }
    if (spec.submit === true) {
      dispatch(tag, [['submitEditing', {text, target: tag}]], step.events);
    }
    dispatch(
      tag,
      [
        ['endEditing', {text, target: tag}],
        ['blur', {target: tag}],
      ],
      step.events,
    );
    if (warnings.length > 0) step.warnings = warnings;
  }

  function scroll(spec, step) {
    const entries = indexTree(readTree());
    const target = findEntry(entries, spec);
    if (target == null) {
      throw new Error(`Target not found: ${JSON.stringify(spec)}`);
    }
    step.target = describe(target);
    step.hit = describe(target);
    // zoomScale must be set: Fantom's ScrollEvent defaults it to 0, and
    // VirtualizedList multiplies item offsets by it (0 makes FlatList think
    // the whole list is above the viewport).
    const options = {x: spec.x ?? 0, y: spec.y ?? 0, zoomScale: 1};
    if (has('enqueueScrollEventByTag')) {
      via.events = 'native';
      NativeFantom.enqueueScrollEventByTag(surfaceId, target.tag, options);
    } else {
      via.events = 'js';
      fallbacks.add('events: js');
      Fantom.enqueueScrollEvent(findElementByTag(target.tag), options);
    }
    step.events.push('scroll');
    NativeFantom.flushEventQueue();
    Fantom.runWorkLoop();
  }

  /**
   * Advances time by `ms` in frame-sized slices. Each slice produces a UI
   * frame (NativeFantom.produceFramesForDuration: advances the host's stub
   * clock and runs one UI tick, which drives C++ animation backends such as
   * Animated and Reanimated), then advances the mocked JS timers by the same
   * amount and runs the work loop, then delivers queued native events.
   */
  function advance(ms) {
    let remaining = ms;
    while (remaining > 0) {
      const slice = Math.min(FRAME_MS, remaining);
      clock += slice;
      NativeFantom.produceFramesForDuration(slice);
      timers.advanceTimersByTime(slice);
      Fantom.flushAllNativeEvents();
      remaining -= slice;
    }
  }

  // --- steps ---------------------------------------------------------------

  function runStep(action, index) {
    const name = Object.keys(action)[0];
    const spec = action[name];
    const step = {index, action: name, target: null, hit: null, events: []};
    let snapshot;
    via.hitTest = null;
    via.events = null;
    try {
      switch (name) {
        case 'tap':
          tap(spec, step);
          break;
        case 'longPress':
          tap(spec, step, {longPress: true});
          break;
        case 'pan':
          pan(spec, step);
          break;
        case 'pinch':
          pinch(spec, step);
          break;
        case 'type':
          type(spec, step);
          break;
        case 'scroll':
          scroll(spec, step);
          break;
        case 'wait':
          advance(spec);
          step.events.push(`wait ${spec}ms`);
          break;
        case 'snapshot':
          snapshot = readTree();
          break;
        default:
          throw new Error(`Unknown action: ${name}`);
      }
    } catch (error) {
      step.error = error instanceof Error ? error.message : String(error);
    }
    // Deliver onLayout etc. caused by the action before the next step.
    try {
      settle(surfaceId);
    } catch (error) {
      step.error ??= error instanceof Error ? error.message : String(error);
    }
    if (via.hitTest != null || via.events != null) {
      step.via = {...via};
    }
    return {step, snapshot};
  }

  return {
    runStep,
    readTree,
    getFallbacks: () => [...fallbacks].sort(),
    dispose: () => timers.uninstall(),
  };
}

/** Runs a whole `--script` (the `run` command). */
export function runActions({root, script, tapMode}) {
  const runner = createRunner({root, tapMode});
  try {
    const steps = [];
    const snapshots = {};
    script.forEach((action, index) => {
      const {step, snapshot} = runner.runStep(action, index);
      if (snapshot !== undefined) snapshots[action.snapshot] = snapshot;
      steps.push(step);
    });
    const final = runner.readTree();
    return {steps, snapshots, final, fallbacks: runner.getFallbacks()};
  } finally {
    runner.dispose();
  }
}
