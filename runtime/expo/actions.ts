/**
 * `tap` / `longPress` / `type` on `@expo/ui` views (type `ExpoUI.<View>`).
 *
 * SwiftUI/Compose controls do not use React Native touches: their callbacks
 * are direct Fabric events (`onX` prop -> event `x`), and modifier callbacks
 * (`onTapGesture`, `clickable`, ...) arrive through `onGlobalEvent`
 * (`NativeFantom.dispatchExpoModifierEvent`). The event is chosen from the
 * `on...` props the JS component passed to the native view (the React
 * props of the host component), else from the view name:
 *
 *   tap      onButtonPress -> buttonPress {}          (SwiftUI Button)
 *            onButtonPressed -> buttonPressed {}      (Compose buttons)
 *            onCheckedChange -> checkedChange {value} (Compose Switch, Checkbox)
 *            onIsOnChange -> isOnChange {isOn}        (SwiftUI Toggle)
 *   type     onTextChange -> textChange {value}       (SwiftUI TextField)
 *            onValueChange -> valueChange {text, selection} (Compose TextField)
 *
 * The actionable view is the target (or hit) node or its nearest ancestor
 * inside the Host (with the fake layout the hit is a Button's Text child).
 */

import {getInstanceHandle} from 'react-native/src/private/webapis/dom/nodes/internals/NodeInternals';

import type {HostElement} from '../gh/hostContext';
import type {A11yNode} from '../tree-index';

const NativeFantom = (require('../fantom/specs/NativeFantom') as typeof import('../fantom/specs/NativeFantom'))
  .default;

/** An index entry, or a hit test stub (no `node`). */
type ExpoEntry = {tag: number | null; type: string; parent: ExpoEntry | null; node?: A11yNode};

/** [type, payload] of a direct event. */
type ExpoEvent = [string, Record<string, unknown>];

type FindElement = (tag: number) => HostElement | null;

type Gesture = {entry: ExpoEntry; type: string};

export const EXPO_PREFIX = 'ExpoUI.';
const HOST_TYPE = 'ExpoUI.HostView';

const TAP_MODIFIERS = ['onTapGesture', 'clickable', 'combinedClickable'];
const LONG_PRESS_MODIFIERS = ['onLongPressGesture', 'combinedClickable'];

export function isExpo(entry: {type: unknown} | null | undefined): boolean {
  return entry != null && typeof entry.type === 'string' && entry.type.startsWith(EXPO_PREFIX);
}

/** The entry and its ancestors up to (and including) the enclosing Host. */
function* upToHost(entry: ExpoEntry): Generator<ExpoEntry> {
  for (let e: ExpoEntry | null = entry; e != null && isExpo(e); e = e.parent) {
    yield e;
    if (e.type === HOST_TYPE) return;
  }
}

function view(entry: ExpoEntry): string {
  return entry.type.slice(EXPO_PREFIX.length);
}

/** `on...` callbacks of the native view's React props, or null if unknown. */
function callbackNames(entry: ExpoEntry, findElement: FindElement): Set<string> | null {
  try {
    const element = findElement(entry.tag!);
    // The instance handle of an element is its fiber.
    const fiber = element != null ? (getInstanceHandle(element) as {memoizedProps?: unknown}) : null;
    const props = fiber?.memoizedProps as Record<string, unknown> | null | undefined;
    if (props == null || typeof props !== 'object') return null;
    return new Set(Object.keys(props).filter(k => /^on[A-Z]/.test(k) && typeof props[k] === 'function'));
  } catch {
    return null;
  }
}

function tapEventsFor(entry: ExpoEntry, callbacks: Set<string> | null): ExpoEvent[] {
  const props = entry.node!.expo ?? {};
  const v = view(entry);
  const checked = props.value ?? props.checked;
  const candidates: Array<[string, ExpoEvent]> = [
    ['onButtonPress', ['buttonPress', {}]],
    ['onButtonPressed', ['buttonPressed', {}]],
    ['onCheckedChange', ['checkedChange', {value: !(checked === true)}]],
    ['onIsOnChange', ['isOnChange', {isOn: !(props.isOn === true)}]],
  ];
  if (callbacks != null) {
    return candidates.filter(([name]) => callbacks.has(name)).map(([, event]) => event);
  }
  // Props unknown: by view name.
  if (v.startsWith('Button') || v.endsWith('Button')) return [candidates[0][1], candidates[1][1]];
  if (v === 'SwitchView' || v === 'CheckboxView') return [candidates[2][1]];
  if (v === 'ToggleView') return [candidates[3][1]];
  return [];
}

function hasModifier(entry: ExpoEntry, types: string[]): string | null {
  const modifiers = entry.node!.expo?.modifiers;
  if (!Array.isArray(modifiers)) return null;
  const found = (modifiers as Array<{$type?: unknown} | null>).find(
    m => m != null && types.includes(m.$type as string) && 'eventListener' in m,
  );
  return found != null ? (found.$type as string) : null;
}

/**
 * What a tap (or long press) on `entry` does: `{actionable, events,
 * gesture}` or null when neither the node nor an ancestor in the Host reacts.
 */
export function expoTapPlan(
  entry: ExpoEntry | null,
  {longPress, findElement}: {longPress: boolean; findElement: FindElement},
): {actionable: ExpoEntry | null; events: ExpoEvent[]; gesture: Gesture | null} | null {
  if (!isExpo(entry)) return null;
  let actionable: ExpoEntry | null = null;
  let events: ExpoEvent[] = [];
  let gesture: Gesture | null = null;
  for (const e of upToHost(entry!)) {
    if (actionable == null && !longPress) {
      const found = tapEventsFor(e, callbackNames(e, findElement));
      if (found.length > 0) {
        actionable = e;
        events = found;
      }
    }
    if (gesture == null) {
      const type = hasModifier(e, longPress ? LONG_PRESS_MODIFIERS : TAP_MODIFIERS);
      if (type != null) gesture = {entry: e, type};
    }
  }
  if (actionable == null && gesture == null) return null;
  return {actionable, events, gesture};
}

/** Sends a modifier callback; returns a warning when the host cannot. */
export function dispatchModifier(gesture: Gesture): string | null {
  if (typeof NativeFantom.dispatchExpoModifierEvent !== 'function') {
    return `the host has no dispatchExpoModifierEvent: the ${gesture.type} modifier was not called (rebuild the host)`;
  }
  NativeFantom.dispatchExpoModifierEvent(gesture.entry.tag!, gesture.type, {});
  return null;
}

/** Events that type `text` (the whole new value) into an ExpoUI text field, or null. */
export function expoTypeEvents(entry: ExpoEntry, text: string, findElement: FindElement): ExpoEvent[] | null {
  if (!isExpo(entry)) return null;
  const callbacks = callbackNames(entry, findElement);
  const selection = {start: text.length, end: text.length};
  const candidates: Array<[string, ExpoEvent]> = [
    ['onTextChange', ['textChange', {value: text}]],
    ['onValueChange', ['valueChange', {text, selection}]],
  ];
  if (callbacks != null) {
    const found = candidates.filter(([name]) => callbacks.has(name)).map(([, event]) => event);
    return found.length > 0 ? found : null;
  }
  const v = view(entry);
  if (v.startsWith('TextField') || v.startsWith('SecureField') || v.startsWith('BasicTextField')) {
    return candidates.map(([, event]) => event);
  }
  return null;
}

/** Current text of an ExpoUI text field. */
export function expoText(entry: ExpoEntry): string {
  const props = entry.node!.expo ?? {};
  for (const key of ['text', 'value', 'defaultValue']) {
    if (typeof props[key] === 'string') return props[key] as string;
  }
  return '';
}
