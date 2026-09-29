/**
 * Output schema of `rn-a11y-tree render`. Keep in sync with README.md.
 */

export type Box = {
  /** Absolute position in the viewport, in dp. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type A11yState = {
  disabled?: boolean;
  selected?: boolean;
  checked?: boolean | 'mixed';
  busy?: boolean;
  expanded?: boolean;
};

export type A11yInfo = {
  /** `accessible` prop (or `true` for elements that are accessible by default). */
  accessible?: boolean;
  label?: string;
  hint?: string;
  state?: A11yState;
  /** `importantForAccessibility` / `aria-hidden` / `accessibilityElementsHidden`. */
  hidden?: boolean;
  /**
   * Raw accessibility-related props as reported by the host. Strings for the
   * `mounted` source; typed values for the `shadowTree` source.
   */
  raw?: Record<string, unknown>;
};

export type TreeNode = {
  /** Stable id within one render: `n0`, `n1`, ... in pre-order. */
  ref: string;
  /** Host component name: `View`, `Paragraph`, `Image`, `Text` (text fragment, mounted source only), ... */
  type: string;
  /**
   * Selector for this node. `#testID` when a testID is set, otherwise a path
   * of types with 1-based sibling indices, e.g. `RootView>View>Paragraph:2`.
   */
  sel: string;
  /** Accessibility role: `role` prop, else `accessibilityRole`, else the component default; `null` if none. */
  role: string | null;
  /** Accessible name: label, else aria-label, else own text, else descendant text if accessible. */
  name: string | null;
  a11y: A11yInfo;
  /**
   * On-screen frame in dp: sum of parent frames, minus the `contentOffset`
   * of ancestor ScrollViews (`shadowTree` source).
   */
  box: Box;
  /**
   * Other props reported by the host: visual style, flattened Yoga style,
   * font props (Paragraph), component props (Image sources, TextInput
   * placeholder, ...). Strings for the `mounted` source.
   */
  style: Record<string, unknown>;
  /** Text content (Paragraph, Text fragment, TextInput value), else `null`. */
  text: string | null;
  testID: string | null;
  /**
   * `true` when the host node has no frame of its own (nested `<Text>` span
   * kept for its a11y props, or another virtual node). `box` is then the
   * parent's box. Only for the `shadowTree` source.
   */
  virtual?: boolean;
  /** Raw debug props from the host; only with `--debug-props` and the `shadowTree` source. */
  debugProps?: Record<string, string>;
  children: TreeNode[];
};

/**
 * Where the tree comes from:
 * - `shadowTree`: the host's `getA11yTree` (committed ShadowTree, full
 *   hierarchy, typed values).
 * - `mounted`: Fantom's `getRenderedOutput` (mounted views after view
 *   flattening, debug-string props).
 */
export type TreeSource = 'shadowTree' | 'mounted';

export type RenderResult = {
  viewport: {width: number; height: number};
  source: TreeSource;
  root: TreeNode;
};

/** Raw shape produced by Fantom's native `RenderOutput::renderView` (`mounted`). */
export type FantomNode = {
  type: string;
  props: Record<string, string>;
  children: Array<FantomNode | string> | string;
};

/**
 * Raw shape produced by the host's `NativeFantom.getA11yTree` (`shadowTree`).
 * Tentative, from the native worker's proposal. Keys are omitted when they
 * have their default value.
 */
export type ShadowNodeJSON = {
  type: string;
  tag?: number;
  /** Relative to the parent. Absent on RawText / nested Text span nodes. */
  frame?: Box;
  /** `"ltr"` / `"rtl"`. */
  layoutDirection?: string;
  pointScaleFactor?: number;
  accessible?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: string;
  role?: string;
  accessibilityState?: {
    disabled?: boolean;
    selected?: boolean;
    checked?: boolean | string;
    busy?: boolean;
    expanded?: boolean | null;
  };
  accessibilityValue?: unknown;
  accessibilityActions?: string[];
  importantForAccessibility?: string;
  accessibilityElementsHidden?: boolean;
  accessibilityLiveRegion?: string;
  accessibilityLabelledBy?: unknown;
  accessibilityLanguage?: string;
  accessibilityViewIsModal?: boolean;
  testID?: string;
  nativeID?: string;
  collapsable?: boolean;
  pointerEvents?: string;
  opacity?: number;
  backgroundColor?: unknown;
  borderColors?: unknown;
  borderRadii?: unknown;
  borderWidths?: unknown;
  zIndex?: number;
  transform?: number[];
  yogaStyle?: Record<string, unknown>;
  text?: string;
  fragments?: Array<{
    text: string;
    fontSize?: number;
    fontWeight?: unknown;
    fontStyle?: string;
    fontFamily?: string;
    color?: unknown;
    lineHeight?: number;
    letterSpacing?: number;
    textAlign?: string;
    textDecorationLine?: string;
    textTransform?: string;
  }>;
  paragraphAttributes?: {
    numberOfLines?: number;
    ellipsizeMode?: string;
    adjustsFontSizeToFit?: boolean;
  };
  // TextInput (AndroidTextInput): `text` is always present ("" when empty)
  defaultValue?: string;
  placeholder?: string;
  editable?: boolean;
  secureTextEntry?: boolean;
  multiline?: boolean;
  // Image
  sources?: Array<{uri: string; width?: number; height?: number}>;
  // Switch (AndroidSwitch)
  value?: unknown;
  disabled?: boolean;
  // ScrollView
  horizontal?: boolean;
  contentOffset?: {x: number; y: number};
  debugProps?: Record<string, string>;
  children?: ShadowNodeJSON[];
};

/** One executed action of `run --script` (built in runtime/actions.js). */
export type StepNode = {
  tag: number | null;
  ref: string | null;
  testID: string | null;
  type: string;
  /** Absolute box in dp; null when the host hit test found a node that is not in the tree. */
  box: Box | null;
};

export type Step = {
  index: number;
  action: string;
  /** The node the action was aimed at (for coordinate taps: the hit node). */
  target: StepNode | null;
  /** The node the host (or JS fallback) hit test found at the tap point. */
  hit: StepNode | null;
  /** Native events sent, in order (plus `wait <n>ms` markers). */
  events: string[];
  /** Which implementation was used: host methods (`native`) or the JS fallback (`js`). */
  via?: {hitTest: 'native' | 'js' | null; events: 'native' | 'js' | null};
  warnings?: string[];
  error?: string;
};

export type RunResult = {
  viewport: {width: number; height: number};
  source: 'shadowTree';
  steps: Step[];
  snapshots: Record<string, TreeNode>;
  final: TreeNode;
};

/** Payload printed by the entry for `run --script`. */
export type HostRunPayload = {
  viewport: {width: number; height: number};
  source: 'shadowTree';
  steps: Step[];
  snapshots: Record<string, ShadowNodeJSON>;
  final: ShadowNodeJSON;
  /** JS fallbacks the runner used, e.g. `hitTest: js`, `scrollOffset: dom`. */
  fallbacks?: string[];
};

/** Payload the JS entry prints inside `{"type":"rn-a11y-tree-result","rnA11yTree":...}`. */
export type HostPayload =
  | {
      viewport: {width: number; height: number};
      source: 'shadowTree';
      tree: ShadowNodeJSON;
    }
  | {
      viewport: {width: number; height: number};
      /** Absent in payloads from entries built before `source` existed. */
      source?: 'mounted';
      tree: FantomNode;
    };
