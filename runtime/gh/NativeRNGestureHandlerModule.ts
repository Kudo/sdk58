/**
 * JS implementation of react-native-gesture-handler's native module
 * (`RNGestureHandlerModule`) for the headless host. `src/bundle.ts` aliases
 * `react-native-gesture-handler/src/specs/NativeRNGestureHandlerModule` to
 * this file, so RNGH's native JS paths (bundle platform `android`) stay
 * intact and only the native side is replaced.
 *
 * Gesture recognition uses RNGH's own web classes (`src/web/`: handlers,
 * GestureHandlerOrchestrator, InteractionManager, NodeManager) with:
 * - HostDelegate: GestureHandlerDelegate over a HostView (no DOM),
 * - HostEventManager: an EventManager fed by the action runner (`feed`)
 *   instead of DOM listeners.
 *
 * Event delivery matches the native platforms:
 * - v2 (GestureDetector with Gesture.*, old-API handler components): flat
 *   payloads on DeviceEventEmitter 'onGestureHandlerEvent' /
 *   'onGestureHandlerStateChange', like Android.
 * - v3 (NativeDetector): Fabric events 'gestureHandlerEvent' /
 *   'gestureHandlerStateChange' / 'gestureHandlerTouchEvent' on the
 *   RNGestureHandlerDetector element (see runtime/gh/HostGestureDetector.tsx).
 *
 * - v2 with worklet callbacks (REANIMATED_WORKLET, NATIVE_ANIMATED_EVENT):
 *   Fabric events 'gestureHandlerEvent' / 'gestureHandlerStateChange' on the
 *   attached view, which Reanimated routes to its `useEvent` worklet.
 *
 * Not supported yet: v3 `dispatchesReanimatedEvents`, virtual detectors,
 * transforms in absoluteToLocal.
 */

import {DeviceEventEmitter} from 'react-native';
import {ActionType} from 'react-native-gesture-handler/src/ActionType';
import {Gestures} from 'react-native-gesture-handler/src/web/Gestures';
import {
  EventTypes,
  NativeGestureRole,
} from 'react-native-gesture-handler/src/web/interfaces';
import EventManager from 'react-native-gesture-handler/src/web/tools/EventManager';
import InteractionManager from 'react-native-gesture-handler/src/web/tools/InteractionManager';
import NodeManager from 'react-native-gesture-handler/src/web/tools/NodeManager';

import type {MouseButton} from 'react-native-gesture-handler/src/handlers/gestureHandlerCommon';
import type {Spec} from 'react-native-gesture-handler/src/specs/NativeRNGestureHandlerModule';
import type {GestureRelations} from 'react-native-gesture-handler/src/v3/types';
import type IGestureHandler from 'react-native-gesture-handler/src/web/handlers/IGestureHandler';
import type {
  AdaptedEvent,
  Config,
  PropsRef,
} from 'react-native-gesture-handler/src/web/interfaces';
import type {GestureHandlerDelegate} from 'react-native-gesture-handler/src/web/tools/GestureHandlerDelegate';

import {findElementByTag, getRootTag} from './hostContext';
import type {HostElement} from './hostContext';

const NativeFantom = (require('../fantom/specs/NativeFantom') as typeof import('../fantom/specs/NativeFantom'))
  .default;
const {NativeEventCategory} = require('../fantom/specs/NativeFantom') as typeof import('../fantom/specs/NativeFantom');

export type PointerKind = 'down' | 'move' | 'up' | 'cancel';

/** One pointer sample from the action runner (`time` from the mocked clock). */
export type PointerSample = {x: number; y: number; pointerId: number; time: number};

export type FeedResult = {handlers: number; detectorEvents: number; reanimatedEvents: number};

/** `globalThis.__rnA11yGestureHandler` (used by runtime/actions.ts). */
export type GestureHandlerBridge = {
  feed(kind: PointerKind, sample: PointerSample, path: number[]): FeedResult;
  readonly attachedCount: number;
  ActionType: typeof ActionType;
};

type Rect = {left: number; top: number; width: number; height: number};

/** What the handlers pass to the event props (`event.nativeEvent`). */
type HandlerEvent = {nativeEvent: unknown};

// --- views -------------------------------------------------------------------

function rectOf(element: HostElement): Rect {
  const rect = element.getBoundingClientRect();
  return {left: rect.left, top: rect.top, width: rect.width, height: rect.height};
}

/**
 * Bounding rect of a view. A `display: contents` view (the v3 detector) has
 * no box of its own; like RNGH web's getEffectiveBoundingRect, use the union
 * of its children's boxes.
 */
function effectiveRect(element: HostElement): Rect {
  const rect = rectOf(element);
  if (rect.width > 0 || rect.height > 0) return rect;
  const children = element.children ?? [];
  let union: Rect | null = null;
  for (let i = 0; i < children.length; i++) {
    const r = effectiveRect(children[i]);
    if (r.width === 0 && r.height === 0) continue;
    if (union == null) {
      union = {...r};
    } else {
      const right = Math.max(union.left + union.width, r.left + r.width);
      const bottom = Math.max(union.top + union.height, r.top + r.height);
      union.left = Math.min(union.left, r.left);
      union.top = Math.min(union.top, r.top);
      union.width = right - union.left;
      union.height = bottom - union.top;
    }
  }
  return union ?? rect;
}

/**
 * What the web handlers expect as `delegate.view`, minus the DOM. The
 * handlers only need identity, `hasAttribute` (NativeViewGestureHandler) and
 * `dispatchEvent` (lifecycle/button events, ignored here).
 */
class HostView {
  // No initializers: babel strips these declarations, the constructor sets them.
  element: HostElement;
  tag: number | undefined;
  style: Record<string, unknown>;
  constructor(element: HostElement) {
    this.element = element;
    this.tag = element.__nativeTag;
    this.style = {};
  }
  hasAttribute() {
    return false;
  }
  getAttribute() {
    return null;
  }
  dispatchEvent() {
    return true;
  }
  getBoundingClientRect() {
    return effectiveRect(this.element);
  }
  get offsetWidth() {
    return effectiveRect(this.element).width;
  }
  get offsetHeight() {
    return effectiveRect(this.element).height;
  }
}

// --- event manager ----------------------------------------------------------

const managers = new Set<HostEventManager>();

/**
 * Pointer routing modeled on RNGH web's PointerEventManager: DOWN only when
 * inside the view; MOVE becomes ENTER/LEAVE/out-of-bounds by the view's
 * bounds; UP only while pointers are down.
 */
class HostEventManager extends EventManager<HostView> {
  // No initializer (babel strips it): undefined until registerListeners.
  enabled: boolean | undefined;
  registerListeners() {
    this.enabled = true;
    managers.add(this);
  }
  unregisterListeners() {
    this.enabled = false;
    managers.delete(this);
  }
  mapEvent(event: AdaptedEvent): AdaptedEvent {
    return event;
  }

  inBounds(x: number, y: number): boolean {
    const r = this.view.getBoundingClientRect();
    return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
  }

  adapt(sample: PointerSample, eventType: EventTypes): AdaptedEvent {
    const r = this.view.getBoundingClientRect();
    return {
      x: sample.x,
      y: sample.y,
      offsetX: sample.x - r.left,
      offsetY: sample.y - r.top,
      pointerId: sample.pointerId,
      eventType,
      pointerType: 0, // PointerType.TOUCH
      time: sample.time,
      button: (eventType === EventTypes.UP || eventType === EventTypes.ADDITIONAL_POINTER_UP ? 0 : 1) as MouseButton,
    };
  }

  /** Returns false if the manager does not take this pointer. */
  feed(kind: PointerKind, sample: PointerSample): boolean {
    if (!this.enabled) return false;
    if (kind === 'down') {
      if (!this.inBounds(sample.x, sample.y)) return false;
      this.markAsInBounds(sample.pointerId);
      if (++this.activePointersCounter > 1) {
        this.onPointerAdd(this.adapt(sample, EventTypes.ADDITIONAL_POINTER_DOWN));
      } else {
        this.onPointerDown(this.adapt(sample, EventTypes.DOWN));
      }
      return true;
    }
    if (kind === 'move') {
      if (this.activePointersCounter === 0) return false;
      const inside = this.inBounds(sample.x, sample.y);
      const wasInside = this.pointersInBounds.indexOf(sample.pointerId) >= 0;
      if (inside && !wasInside) {
        this.markAsInBounds(sample.pointerId);
        this.onPointerEnter(this.adapt(sample, EventTypes.ENTER));
      } else if (inside) {
        this.onPointerMove(this.adapt(sample, EventTypes.MOVE));
      } else if (wasInside) {
        this.markAsOutOfBounds(sample.pointerId);
        this.onPointerLeave(this.adapt(sample, EventTypes.LEAVE));
      } else {
        this.onPointerOutOfBounds(this.adapt(sample, EventTypes.MOVE));
      }
      return true;
    }
    if (kind === 'up') {
      if (this.activePointersCounter === 0) return false;
      this.markAsOutOfBounds(sample.pointerId);
      if (--this.activePointersCounter > 0) {
        this.onPointerRemove(this.adapt(sample, EventTypes.ADDITIONAL_POINTER_UP));
      } else {
        this.onPointerUp(this.adapt(sample, EventTypes.UP));
      }
      return true;
    }
    if (kind === 'cancel') {
      this.onPointerCancel(this.adapt(sample, EventTypes.CANCEL));
      this.resetManager();
      return true;
    }
    return false;
  }
}

// --- delegate ----------------------------------------------------------------

class HostDelegate {
  // No initializers: babel strips these declarations, the constructor sets them.
  view: HostView | null;
  handler: IGestureHandler | null;
  manager: HostEventManager | null;
  constructor() {
    this.view = null;
    this.handler = null;
    this.manager = null;
  }
  init(view: HostView, handler: IGestureHandler) {
    this.view = view;
    this.handler = handler;
    this.manager = new HostEventManager(view);
    handler.attachEventManager(this.manager);
    this.manager.setEnabled(handler.enabled !== false);
  }
  detach() {
    this.manager?.setEnabled(false);
    this.manager = null;
    this.view = null;
  }
  updateDOM() {}
  isPointerInBounds({x, y}: {x: number; y: number}) {
    return this.manager != null && this.view != null && this.manager.inBounds(x, y);
  }
  measureView() {
    const r = this.view!.getBoundingClientRect();
    return {pageX: r.left, pageY: r.top, width: r.width, height: r.height};
  }
  // Transforms are not applied (v1).
  absoluteToLocal(absoluteX: number, absoluteY: number) {
    const r = this.view!.getBoundingClientRect();
    return {x: absoluteX - r.left, y: absoluteY - r.top};
  }
  reset() {
    this.manager?.resetManager();
  }
  onBegin() {}
  onActivate() {}
  onEnd() {}
  onCancel() {}
  onFail() {}
  onEnabledChange() {
    this.manager?.setEnabled(this.handler!.enabled !== false);
  }
  destroy() {
    this.manager?.unregisterListeners();
  }
}

// --- event delivery ------------------------------------------------------------

/** v2: flat payloads on DeviceEventEmitter, like Android. */
function deviceEventProps(): {current: PropsRef} {
  return {
    current: {
      onGestureHandlerEvent: (event: HandlerEvent) =>
        DeviceEventEmitter.emit('onGestureHandlerEvent', event.nativeEvent),
      onGestureHandlerStateChange: (event: HandlerEvent) =>
        DeviceEventEmitter.emit('onGestureHandlerStateChange', event.nativeEvent),
      onGestureHandlerTouchEvent: (event: HandlerEvent) =>
        DeviceEventEmitter.emit('onGestureHandlerEvent', event.nativeEvent),
    },
  };
}

/** Native events queued during `feed`; the runner flushes them. */
let pendingDetectorEvents = 0;
/** Of those, events for Reanimated (applied on the next UI tick). */
let pendingReanimatedEvents = 0;

function enqueueOnElement(element: HostElement, type: string, payload: unknown): void {
  const tag = element.__nativeTag!;
  if (typeof NativeFantom.enqueueNativeEventByTag === 'function' && getRootTag() != null) {
    NativeFantom.enqueueNativeEventByTag(getRootTag()!, tag, type, payload, NativeEventCategory.Discrete, false);
  } else {
    NativeFantom.enqueueNativeEvent(
      (
        require('react-native/src/private/webapis/dom/nodes/internals/NodeInternals') as typeof import('react-native/src/private/webapis/dom/nodes/internals/NodeInternals')
      ).getNativeNodeReference(element),
      type,
      payload,
      NativeEventCategory.Discrete,
      false,
    );
  }
  pendingDetectorEvents++;
}

/**
 * v2 with worklet callbacks (REANIMATED_WORKLET) and NATIVE_ANIMATED_EVENT:
 * like Android's reanimatedProxy.sendEvent, Fabric events on the attached
 * view with the flat payload. Fabric names them topGestureHandlerEvent /
 * topGestureHandlerStateChange; Reanimated maps top* to on* and runs the
 * `useEvent(..., ['onGestureHandlerStateChange', 'onGestureHandlerEvent'])`
 * worklet registered for that view on the UI runtime.
 */
/**
 * Android hands these events to Reanimated directly, so React never sees
 * them. Here they are Fabric events and also reach React, which throws on
 * event types no view config declares ("Unsupported top level event type")
 * unless an RNGestureHandlerDetector (which declares them) is rendered.
 * Declare them once; React then finds no listener and ignores them.
 */
let reanimatedEventTypesRegistered = false;
function registerReanimatedEventTypes() {
  if (reanimatedEventTypesRegistered) return;
  reanimatedEventTypesRegistered = true;
  const {customDirectEventTypes} = require('react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry') as typeof import('react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry');
  for (const [top, registrationName] of [
    ['topGestureHandlerEvent', 'onGestureHandlerEvent'],
    ['topGestureHandlerStateChange', 'onGestureHandlerStateChange'],
  ]) {
    if (customDirectEventTypes[top] == null) {
      customDirectEventTypes[top] = {registrationName};
    }
  }
}

function viewEventProps(element: HostElement): {current: PropsRef} {
  registerReanimatedEventTypes();
  const send = (type: string) => (event: HandlerEvent) => {
    enqueueOnElement(element, type, event.nativeEvent);
    pendingReanimatedEvents++;
  };
  return {
    current: {
      onGestureHandlerEvent: send('gestureHandlerEvent'),
      onGestureHandlerStateChange: send('gestureHandlerStateChange'),
      // Android sends touch events for Reanimated as onGestureHandlerEvent.
      onGestureHandlerTouchEvent: send('gestureHandlerEvent'),
    },
  };
}

/** v3: Fabric events on the RNGestureHandlerDetector element. */
function detectorEventProps(detectorElement: HostElement): {current: PropsRef} {
  const send = (type: string) => (event: HandlerEvent) => {
    enqueueOnElement(detectorElement, type, event.nativeEvent);
  };
  return {
    current: {
      onGestureHandlerEvent: send('gestureHandlerEvent'),
      onGestureHandlerStateChange: send('gestureHandlerStateChange'),
      onGestureHandlerTouchEvent: send('gestureHandlerTouchEvent'),
    },
  };
}

function isButtonElement(element: HostElement): boolean {
  return String(element.tagName ?? '').endsWith('RNGestureHandlerButton');
}

/**
 * Attaches a handler to an element. `detectorElement` is set for v3
 * (NATIVE_DETECTOR); the handler then reports through the detector.
 */
export function attachToElement(
  handlerTag: number,
  element: HostElement,
  actionType: ActionType,
  detectorElement: HostElement | null | undefined,
): void {
  const handler = NodeManager.getHandler(handlerTag);
  const propsRef =
    detectorElement != null
      ? detectorEventProps(detectorElement)
      : actionType === ActionType.REANIMATED_WORKLET ||
          actionType === ActionType.NATIVE_ANIMATED_EVENT
        ? viewEventProps(element)
        : deviceEventProps();
  handler.init(
    // The web handlers pass this to the delegate (HostDelegate.init), which takes a HostView.
    new HostView(element) as unknown as number,
    propsRef,
    actionType,
    detectorElement != null ? {current: detectorElement} : null,
  );
  // RNGH web derives the Native handler's role from DOM attributes. On
  // Android an RNGestureHandlerButton activates on release like a button;
  // give the web handler the same role.
  if (handler.shouldAttachGestureToChildView() && isButtonElement(element)) {
    // `role` is private to NativeViewGestureHandler.
    (handler as unknown as {role: NativeGestureRole}).role = NativeGestureRole.Button;
  }
}

// --- the module -----------------------------------------------------------------

const Module = {
  createGestureHandler(handlerName: string, handlerTag: number, config: object | null | undefined) {
    const GestureClass = Gestures[handlerName as keyof typeof Gestures] as (typeof Gestures)[keyof typeof Gestures] | undefined;
    if (GestureClass == null) {
      throw new Error(`react-native-gesture-handler: ${handlerName} is not supported by the headless host`);
    }
    // HostDelegate.init takes a HostView where the web delegate takes a view tag.
    NodeManager.createGestureHandler(
      handlerTag,
      new GestureClass(new HostDelegate() as unknown as GestureHandlerDelegate<unknown, IGestureHandler>),
    );
    Module.setGestureHandlerConfig(handlerTag, config ?? {});
  },
  // Native (v2) signature: the view is a React tag.
  attachGestureHandler(handlerTag: number, viewTag: number, actionType: number) {
    const element = findElementByTag(viewTag);
    if (element == null) {
      throw new Error(`react-native-gesture-handler: no view with tag ${viewTag}`);
    }
    attachToElement(handlerTag, element, actionType as ActionType, null);
  },
  setGestureHandlerConfig(handlerTag: number, newConfig: object) {
    NodeManager.getHandler(handlerTag).setGestureConfig(newConfig as Config);
  },
  updateGestureHandlerConfig(handlerTag: number, newConfig: object) {
    if (NodeManager.hasHandler(handlerTag)) {
      NodeManager.getHandler(handlerTag).updateGestureConfig(newConfig as Partial<Config>);
    }
  },
  configureRelations(handlerTag: number, relations: object) {
    if (!NodeManager.hasHandler(handlerTag)) return;
    InteractionManager.instance.configureInteractions(
      NodeManager.getHandler(handlerTag),
      relations as GestureRelations | Config,
    );
  },
  dropGestureHandler(handlerTag: number) {
    NodeManager.dropGestureHandler(handlerTag);
  },
  flushOperations() {},
  installUIRuntimeBindings() {
    return true;
  },
} satisfies Spec;

export default Module;

// --- input from the action runner ------------------------------------------------

const captured = new Map<number, HostEventManager[]>(); // pointerId -> HostEventManager[]

/** A manager's `view` (protected in EventManager). */
type WithView = {view: HostView};

/**
 * Feeds one pointer sample. `path` is the list of view tags from the root to
 * the hit node; on DOWN the sample goes to the managers of views on that
 * path, deepest first (DOM bubbling order), and later samples of the same
 * pointer go to the same managers (pointer capture).
 * Returns the number of handlers that received the sample and whether
 * detector events were queued.
 */
function feed(kind: PointerKind, sample: PointerSample, path: number[]): FeedResult {
  pendingDetectorEvents = 0;
  pendingReanimatedEvents = 0;
  let targets: HostEventManager[];
  if (kind === 'down') {
    const order = new Map(path.map((tag, index) => [tag, index]));
    targets = [...managers]
      .filter(m => order.has((m as unknown as WithView).view.tag!))
      .sort(
        (a, b) =>
          order.get((b as unknown as WithView).view.tag!)! - order.get((a as unknown as WithView).view.tag!)!,
      );
    const taken = targets.filter(m => m.feed('down', sample));
    captured.set(sample.pointerId, taken);
    return {
      handlers: taken.length,
      detectorEvents: pendingDetectorEvents,
      reanimatedEvents: pendingReanimatedEvents,
    };
  }
  targets = captured.get(sample.pointerId) ?? [];
  for (const m of targets) m.feed(kind, sample);
  if (kind === 'up' || kind === 'cancel') captured.delete(sample.pointerId);
  return {
    handlers: targets.length,
    detectorEvents: pendingDetectorEvents,
    reanimatedEvents: pendingReanimatedEvents,
  };
}

globalThis.__rnA11yGestureHandler = {
  feed,
  get attachedCount() {
    return managers.size;
  },
  ActionType,
};

// RNGH reads this for the v3 detector's `moduleId` prop.
if (globalThis._RNGH_MODULE_ID == null) {
  globalThis._RNGH_MODULE_ID = 1;
}
