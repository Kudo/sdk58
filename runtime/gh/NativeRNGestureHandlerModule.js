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
 *   RNGestureHandlerDetector element (see runtime/gh/HostGestureDetector.js).
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

import {findElementByTag, getRootTag} from './hostContext';

const NativeFantom = require('../fantom/specs/NativeFantom').default;
const {NativeEventCategory} = require('../fantom/specs/NativeFantom');

// --- views -------------------------------------------------------------------

function rectOf(element) {
  const rect = element.getBoundingClientRect();
  return {left: rect.left, top: rect.top, width: rect.width, height: rect.height};
}

/**
 * Bounding rect of a view. A `display: contents` view (the v3 detector) has
 * no box of its own; like RNGH web's getEffectiveBoundingRect, use the union
 * of its children's boxes.
 */
function effectiveRect(element) {
  const rect = rectOf(element);
  if (rect.width > 0 || rect.height > 0) return rect;
  const children = element.children ?? [];
  let union = null;
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
  constructor(element) {
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

const managers = new Set();

/**
 * Pointer routing modeled on RNGH web's PointerEventManager: DOWN only when
 * inside the view; MOVE becomes ENTER/LEAVE/out-of-bounds by the view's
 * bounds; UP only while pointers are down.
 */
class HostEventManager extends EventManager {
  registerListeners() {
    this.enabled = true;
    managers.add(this);
  }
  unregisterListeners() {
    this.enabled = false;
    managers.delete(this);
  }
  mapEvent(event) {
    return event;
  }

  inBounds(x, y) {
    const r = this.view.getBoundingClientRect();
    return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
  }

  adapt(sample, eventType) {
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
      button: eventType === EventTypes.UP || eventType === EventTypes.ADDITIONAL_POINTER_UP ? 0 : 1,
    };
  }

  /** Returns false if the manager does not take this pointer. */
  feed(kind, sample) {
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
  constructor() {
    this.view = null;
    this.handler = null;
    this.manager = null;
  }
  init(view, handler) {
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
  isPointerInBounds({x, y}) {
    return this.manager != null && this.view != null && this.manager.inBounds(x, y);
  }
  measureView() {
    const r = this.view.getBoundingClientRect();
    return {pageX: r.left, pageY: r.top, width: r.width, height: r.height};
  }
  // Transforms are not applied (v1).
  absoluteToLocal(absoluteX, absoluteY) {
    const r = this.view.getBoundingClientRect();
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
    this.manager?.setEnabled(this.handler.enabled !== false);
  }
  destroy() {
    this.manager?.unregisterListeners();
  }
}

// --- event delivery ------------------------------------------------------------

/** v2: flat payloads on DeviceEventEmitter, like Android. */
function deviceEventProps() {
  return {
    current: {
      onGestureHandlerEvent: event =>
        DeviceEventEmitter.emit('onGestureHandlerEvent', event.nativeEvent),
      onGestureHandlerStateChange: event =>
        DeviceEventEmitter.emit('onGestureHandlerStateChange', event.nativeEvent),
      onGestureHandlerTouchEvent: event =>
        DeviceEventEmitter.emit('onGestureHandlerEvent', event.nativeEvent),
    },
  };
}

/** Native events queued during `feed`; the runner flushes them. */
let pendingDetectorEvents = 0;
/** Of those, events for Reanimated (applied on the next UI tick). */
let pendingReanimatedEvents = 0;

function enqueueOnElement(element, type, payload) {
  const tag = element.__nativeTag;
  if (typeof NativeFantom.enqueueNativeEventByTag === 'function' && getRootTag() != null) {
    NativeFantom.enqueueNativeEventByTag(getRootTag(), tag, type, payload, NativeEventCategory.Discrete, false);
  } else {
    NativeFantom.enqueueNativeEvent(
      require('react-native/src/private/webapis/dom/nodes/internals/NodeInternals').getNativeNodeReference(element),
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
function viewEventProps(element) {
  const send = type => event => {
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
function detectorEventProps(detectorElement) {
  const send = type => event => {
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

function isButtonElement(element) {
  return String(element.tagName ?? '').endsWith('RNGestureHandlerButton');
}

/**
 * Attaches a handler to an element. `detectorElement` is set for v3
 * (NATIVE_DETECTOR); the handler then reports through the detector.
 */
export function attachToElement(handlerTag, element, actionType, detectorElement) {
  const handler = NodeManager.getHandler(handlerTag);
  const propsRef =
    detectorElement != null
      ? detectorEventProps(detectorElement)
      : actionType === ActionType.REANIMATED_WORKLET ||
          actionType === ActionType.NATIVE_ANIMATED_EVENT
        ? viewEventProps(element)
        : deviceEventProps();
  handler.init(
    new HostView(element),
    propsRef,
    actionType,
    detectorElement != null ? {current: detectorElement} : null,
  );
  // RNGH web derives the Native handler's role from DOM attributes. On
  // Android an RNGestureHandlerButton activates on release like a button;
  // give the web handler the same role.
  if (handler.shouldAttachGestureToChildView() && isButtonElement(element)) {
    handler.role = NativeGestureRole.Button;
  }
}

// --- the module -----------------------------------------------------------------

const Module = {
  createGestureHandler(handlerName, handlerTag, config) {
    const GestureClass = Gestures[handlerName];
    if (GestureClass == null) {
      throw new Error(`react-native-gesture-handler: ${handlerName} is not supported by the headless host`);
    }
    NodeManager.createGestureHandler(handlerTag, new GestureClass(new HostDelegate()));
    Module.setGestureHandlerConfig(handlerTag, config ?? {});
  },
  // Native (v2) signature: the view is a React tag.
  attachGestureHandler(handlerTag, viewTag, actionType) {
    const element = findElementByTag(viewTag);
    if (element == null) {
      throw new Error(`react-native-gesture-handler: no view with tag ${viewTag}`);
    }
    attachToElement(handlerTag, element, actionType, null);
  },
  setGestureHandlerConfig(handlerTag, newConfig) {
    NodeManager.getHandler(handlerTag).setGestureConfig(newConfig);
  },
  updateGestureHandlerConfig(handlerTag, newConfig) {
    if (NodeManager.hasHandler(handlerTag)) {
      NodeManager.getHandler(handlerTag).updateGestureConfig(newConfig);
    }
  },
  configureRelations(handlerTag, relations) {
    if (!NodeManager.hasHandler(handlerTag)) return;
    InteractionManager.instance.configureInteractions(NodeManager.getHandler(handlerTag), relations);
  },
  dropGestureHandler(handlerTag) {
    NodeManager.dropGestureHandler(handlerTag);
  },
  flushOperations() {},
  installUIRuntimeBindings() {
    return true;
  },
};

export default Module;

// --- input from the action runner ------------------------------------------------

const captured = new Map(); // pointerId -> HostEventManager[]

/**
 * Feeds one pointer sample. `path` is the list of view tags from the root to
 * the hit node; on DOWN the sample goes to the managers of views on that
 * path, deepest first (DOM bubbling order), and later samples of the same
 * pointer go to the same managers (pointer capture).
 * Returns the number of handlers that received the sample and whether
 * detector events were queued.
 */
function feed(kind, sample, path) {
  pendingDetectorEvents = 0;
  pendingReanimatedEvents = 0;
  let targets;
  if (kind === 'down') {
    const order = new Map(path.map((tag, index) => [tag, index]));
    targets = [...managers]
      .filter(m => order.has(m.view.tag))
      .sort((a, b) => order.get(b.view.tag) - order.get(a.view.tag));
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
