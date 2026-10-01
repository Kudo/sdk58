/**
 * Accessibility semantics of `@expo/ui` views (tree type `ExpoUI.<View>`),
 * from the view name and its props (`expo`): what VoiceOver/TalkBack derive
 * from the SwiftUI/Compose control. Explicit a11y props (role, label) win.
 */

import type {A11yState} from './schema.ts';

export const EXPO_UI_PREFIX = 'ExpoUI.';

type Props = Record<string, unknown>;

type Modifier = {$type?: unknown; [key: string]: unknown};

function modifiers(props: Props): Modifier[] {
  return Array.isArray(props.modifiers) ? (props.modifiers as Modifier[]) : [];
}

function modifier(props: Props, type: string): Modifier | undefined {
  return modifiers(props).find(m => m?.$type === type);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** `ExpoUI.Button` -> `Button`; null for other types. */
export function expoViewName(type: string): string | null {
  return type.startsWith(EXPO_UI_PREFIX) ? type.slice(EXPO_UI_PREFIX.length) : null;
}

const RADIO_GROUP_PICKER_STYLES = new Set(['segmented', 'inline', 'palette', 'radioGroup']);

export function expoRole(view: string, props: Props): string | null {
  if (view === 'ToggleButton') return 'togglebutton';
  if (view === 'RadioButton') return 'radio';
  if (view.startsWith('Button') || view.endsWith('Button') || view === 'FloatingActionButton') return 'button';
  if (view === 'SwitchView' || view === 'ToggleView' || view === 'SyncSwitchView' || view === 'SyncToggleView') {
    return 'switch';
  }
  if (view === 'CheckboxView') return 'checkbox';
  if (view === 'SliderView') return 'adjustable';
  if (view.startsWith('TextField') || view.startsWith('SecureField') || view.startsWith('BasicTextField')) {
    return 'textbox';
  }
  if (view === 'TextView') return 'text';
  if (view.startsWith('Image') || view.startsWith('Icon')) return 'image';
  if (view === 'PickerView') {
    const style = str(modifier(props, 'pickerStyle')?.style) ?? str(props.pickerStyle) ?? str(props.variant);
    return style != null && RADIO_GROUP_PICKER_STYLES.has(style) ? 'radiogroup' : 'combobox';
  }
  if (view === 'LinkView') return 'link';
  if (view === 'ProgressView' || view.startsWith('Progress') || view === 'LoadingIndicatorView') {
    return 'progressbar';
  }
  return null;
}

/** Text content: TextView `text` (and TextField values). */
export function expoText(view: string, props: Props): string | null {
  if (view === 'TextView') return str(props.text);
  if (view.startsWith('TextField') || view.startsWith('SecureField') || view.startsWith('BasicTextField')) {
    return str(props.text) ?? str(props.value) ?? str(props.defaultValue);
  }
  return null;
}

/** Accessible name from the view's own props (the host already maps the accessibilityLabel modifier). */
export function expoLabel(view: string, props: Props): string | null {
  return str(props.label) ?? str(props.title) ?? (view === 'TextView' ? str(props.text) : null) ?? str(props.placeholder);
}

export function expoState(view: string, props: Props): A11yState | undefined {
  const state: A11yState = {};
  const role = expoRole(view, props);
  if (role === 'switch' || role === 'checkbox' || role === 'togglebutton' || role === 'radio') {
    const on = props.isOn ?? props.value ?? props.checked ?? props.selected;
    if (typeof on === 'boolean') {
      if (role === 'radio') state.selected = on;
      else state.checked = on;
    }
  }
  if (props.enabled === false || props.disabled === true) state.disabled = true;
  return Object.keys(state).length > 0 ? state : undefined;
}

/** Roles that group their descendants' text into one element (the name comes from the children). */
export function expoGroupsChildren(role: string | null): boolean {
  return role === 'button' || role === 'togglebutton' || role === 'link';
}

