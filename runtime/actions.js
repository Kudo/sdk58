/**
 * Action runner for `rn-a11y-tree run --script`. Runs inside the bundle
 * after the initial render, outside any Fantom task (each action runs the
 * work loop itself).
 *
 * Host methods (NativeFantom, added by react-native-a11y-tree's host):
 *   getA11yTree(surfaceId, includeDebugProps) -> string       (required)
 *   hitTest(surfaceId, x, y) -> string ('{"tag","type","path"}' | 'null')
 *   enqueueNativeEventByTag(surfaceId, tag, type, payload?, category?, isUnique?)
 *   enqueueScrollEventByTag(surfaceId, tag, {x, y, zoomScale?})
 *   setTextInputTextByTag(surfaceId, tag, text)
 * All but getA11yTree are optional: without them the runner falls back to
 * a JS hit test over the getA11yTree boxes and to Fantom's
 * `enqueueNativeEvent` / `enqueueScrollEvent` on the element found by tag in
 * `root.document`. Each step reports which path it used (`via`).
 */

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
const SWITCH_TYPES = new Set(['AndroidSwitch', 'Switch']);

function has(name) {
  return typeof NativeFantom[name] === 'function';
}

export function runActions({root, script, tapMode}) {
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
    const tree = JSON.parse(NativeFantom.getA11yTree(surfaceId, false));
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
      return entries.find(e => e.tag === result.tag) ?? {
        tag: result.tag,
        type: result.type,
        ref: null,
        testID: null,
        box: null,
      };
    }
    via.hitTest = 'js';
    fallbacks.add('hitTest: js');
    return hitTestEntries(entries, x, y);
  }

  function touch(tag, point, box) {
    const t = timestamp++;
    const touchPoint = {
      pageX: point.x,
      pageY: point.y,
      locationX: box ? point.x - box.x : 0,
      locationY: box ? point.y - box.y : 0,
      identifier: 1,
      target: tag,
      timestamp: t,
    };
    return {
      touches: [touchPoint],
      changedTouches: [touchPoint],
      target: tag,
      identifier: 1,
      timestamp: t,
    };
  }

  function touchEndPayload(start) {
    return {...start, touches: [], timestamp: timestamp++};
  }

  // --- targets -------------------------------------------------------------

  function describe(entry) {
    if (entry == null) return null;
    return {
      tag: entry.tag,
      ref: entry.ref,
      testID: entry.testID,
      type: entry.type,
      box: entry.box,
    };
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
      point = center(target.box);
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
      const start = touch(hit.tag, point, hit.box);
      dispatch(hit.tag, [['touchStart', start, NativeEventCategory.ContinuousStart]], step.events);
      if (longPress) {
        timers.advanceTimersByTime(LONG_PRESS_MS);
        step.events.push(`wait ${LONG_PRESS_MS}ms`);
      }
      dispatch(hit.tag, [['touchEnd', touchEndPayload(start), NativeEventCategory.ContinuousEnd]], step.events);
    }
    if (!longPress && (tapMode === 'click' || tapMode === 'both')) {
      // `click` does not bubble from a child (e.g. the label Paragraph) to
      // the Pressable in this host, so send it to the target when the hit is
      // inside it. Coordinate taps have no target; they use the hit node.
      const clickTag = target != null && isWithin(hit, target) ? target.tag : hit.tag;
      dispatch(clickTag, [['click', {}]], step.events);
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
      dispatch(
        tag,
        [
          ['keyPress', {key, target: tag}],
          ['change', {text, eventCount, target: tag}],
        ],
        step.events,
      );
      if (has('setTextInputTextByTag')) {
        NativeFantom.setTextInputTextByTag(surfaceId, tag, text);
      } else if (warnings.length === 0) {
        fallbacks.add('text: not reflected');
        warnings.push('Host has no setTextInputTextByTag: the ShadowTree text of the input is not updated');
      }
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

  // --- run -----------------------------------------------------------------

  const steps = [];
  const snapshots = {};
  try {
    script.forEach((action, index) => {
      const name = Object.keys(action)[0];
      const spec = action[name];
      const step = {index, action: name, target: null, hit: null, events: []};
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
          case 'type':
            type(spec, step);
            break;
          case 'scroll':
            scroll(spec, step);
            break;
          case 'wait':
            timers.advanceTimersByTime(spec);
            step.events.push(`wait ${spec}ms`);
            break;
          case 'snapshot':
            snapshots[spec] = readTree();
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
      steps.push(step);
    });
    const final = readTree();
    return {steps, snapshots, final, fallbacks: [...fallbacks].sort()};
  } finally {
    timers.uninstall();
  }
}
