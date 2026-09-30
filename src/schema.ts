/**
 * Output schema of `rn-a11y-tree` (render, run, check, session, errors).
 * Keep in sync with README.md. `bun run schema` generates `schema/*.json` from
 * the exported types listed in scripts/gen-schema.ts.
 */

import type {CheckResult, Rules} from './check.ts';
import type {TreeDiff} from './diff.ts';
import type {ErrorInfo, LogEntry} from './errors.ts';
import type {Format} from './format.ts';
import type {ProjectConfig} from './presets.ts';
import type {Action} from './script.ts';

export type {Action, CheckResult, ErrorInfo, LogEntry, ProjectConfig, Rules, TreeDiff};

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

/** Layout engine of an Expo Host (`emulatedBy`). */
export type ExpoLayoutEngine = 'swiftui' | 'compose';

export type TreeNode = {
  /** Id within one tree: `n0`, `n1`, ... in pre-order (changes when the tree changes). */
  ref: string;
  /**
   * Stable key: `testID` when set, else `<parent key>/<type>:<n>` (n = index
   * among siblings of the same type); the root is its type.
   */
  key: string;
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
  /**
   * Where the node is drawn, when it differs from `box`: the bounding box of
   * the (mounted) frame after the transforms of the node and its ancestors
   * (`shadowTree` source). Absent when there is no transform or mounted
   * frame override on the path.
   */
  visualBox?: Box;
  /**
   * Product of the node's and its ancestors' opacity (mounted opacity when
   * the host reports one). Present only when below 1.
   */
  effectiveOpacity?: number;
  /**
   * Expo module views (`@expo/ui`, type `ExpoUI.<View>`): the props the view
   * received (`modifiers` verbatim; modifier callbacks are
   * `"eventListener": null`).
   */
  expo?: Record<string, unknown>;
  /**
   * Expo module views: `emulated` when a SwiftUI/Compose layout engine (or
   * the Host's content sizing) produced the frame, `placeholder` when no
   * engine handled the subtree (the frame is not the drawn one). Hosts
   * before the label change mark only the Host `emulated`.
   */
  layout?: 'emulated' | 'placeholder';
  /** On an Expo Host: the engine that laid out its subtree. */
  emulatedBy?: ExpoLayoutEngine;
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

/**
 * The host's build info (`NativeFantom.getHostInfo()`), or `{protocolVersion}`
 * from a `protocolVersion:<n>` capability. Absent for hosts that report
 * neither.
 */
export type HostRuntimeInfo = {
  /** Version of the CLI <-> host contract; the CLI refuses unsupported ones (HOST_INCOMPATIBLE). */
  protocolVersion: number;
  rnVersion?: string;
  buildType?: string;
  sanitize?: boolean;
  engines?: {swiftui?: boolean; compose?: boolean; [engine: string]: boolean | undefined};
  fonts?: {roboto?: boolean; [font: string]: boolean | undefined};
  [key: string]: unknown;
};

export type RenderResult = {
  viewport: {width: number; height: number};
  source: TreeSource;
  root: TreeNode;
  hostInfo?: HostRuntimeInfo;
  /** App console output (only when there was any); `known: true` marks common React Native noise. */
  logs?: LogEntry[];
};

export type StepError = {code: string; message: string};

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
  /**
   * Offset of the children's origin relative to this node's frame, where
   * non-zero (ScrollView: -contentOffset; RNSScreen: (0, topInset + headerHeight)).
   */
  contentOriginOffset?: {x: number; y: number};
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
  /**
   * Ancestors' and own background colors composited over the window
   * background (`rgba(...)`). On every Paragraph, and on nodes where it
   * differs from `backgroundColor`.
   */
  effectiveBackground?: string;
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
  contentSize?: {width: number; height: number};
  // react-native-screens: RNSScreen
  activityState?: number;
  stackPresentation?: string;
  stackAnimation?: string;
  screenId?: string;
  gestureEnabled?: boolean;
  stateFrameSize?: unknown;
  stateContentOffset?: unknown;
  // RNSScreenStackHeaderConfig
  title?: string;
  hidden?: boolean;
  translucent?: boolean;
  largeTitle?: boolean;
  backTitle?: string;
  hideBackButton?: boolean;
  /** Mounted-view values that differ from the ShadowNode (e.g. during Reanimated `entering`). */
  mounted?: {
    opacity?: number;
    transform?: number[];
    backgroundColor?: unknown;
    frame?: Box;
  };
  // RNCSafeAreaProvider / RNCSafeAreaView
  insets?: {top: number; left: number; right: number; bottom: number};
  // Expo module views
  expo?: Record<string, unknown>;
  layout?: 'emulated' | 'placeholder';
  emulatedBy?: ExpoLayoutEngine;
  debugProps?: Record<string, string>;
  children?: ShadowNodeJSON[];
};

/** One executed action of `run --script` (built in runtime/actions.ts). */
export type StepNode = {
  tag: number | null;
  ref: string | null;
  /** Stable key (see TreeNode.key). */
  key?: string | null;
  testID: string | null;
  type: string;
  /** Absolute box in dp; null when the host hit test found a node that is not in the tree. */
  box: Box | null;
  /** Only on `hit` from the host hit test: the point was outside the node's frame but inside its hitSlop. */
  viaHitSlop?: boolean;
};

export type Step = {
  index: number;
  action: string;
  /** The node the action was aimed at (for coordinate taps: the hit node). */
  target: StepNode | null;
  /** The node the host (or JS fallback) hit test found at the tap point. */
  hit: StepNode | null;
  /**
   * Native events sent, in order (plus `wait <n>ms` markers; `gh:down` /
   * `gh:move xN` / `gh:up` for pointer samples fed to
   * react-native-gesture-handler).
   */
  events: string[];
  /** Number of react-native-gesture-handler handlers that received the pointer. */
  gestureHandlers?: number;
  /** Which implementation was used: host methods (`native`) or the JS fallback (`js`). */
  via?: {hitTest: 'native' | 'js' | null; events: 'native' | 'js' | null};
  warnings?: string[];
  /** Runtime payloads carry a string; the CLI output has {code, message}. */
  error?: string | StepError;
  /** With `run --diff` / session `diff: true`: changes made by this step. */
  diff?: TreeDiff;
};

export type RunResult = {
  viewport: {width: number; height: number};
  source: 'shadowTree';
  steps: Step[];
  snapshots: Record<string, TreeNode>;
  final: TreeNode;
  /** JS fallbacks used because the host lacks native methods (empty when none). */
  fallbacks: string[];
  /** Optional host features found (NativeFantom methods and getCapabilities()). */
  capabilities: string[];
  hostInfo?: HostRuntimeInfo;
  logs?: LogEntry[];
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
  capabilities?: string[];
  hostInfo?: HostRuntimeInfo | null;
  /** With `--diff`: the tree before the first step and after each step. */
  stepTrees?: ShadowNodeJSON[];
};

/** Payload the JS entry prints inside `{"type":"rn-a11y-tree-result","rnA11yTree":...}`. */
export type HostPayload =
  | {
      viewport: {width: number; height: number};
      source: 'shadowTree';
      hostInfo?: HostRuntimeInfo | null;
      tree: ShadowNodeJSON;
    }
  | {
      viewport: {width: number; height: number};
      /** Absent in payloads from entries built before `source` existed. */
      source?: 'mounted';
      hostInfo?: HostRuntimeInfo | null;
      tree: FantomNode;
    };

// --- other outputs and inputs -------------------------------------------------------

/** `render --select ...` (JSON format): the matching nodes. */
export type QueryResult = {
  viewport: {width: number; height: number};
  source: TreeSource;
  matches: TreeNode[];
  logs?: LogEntry[];
};

/** Any failure: `{"error": {...}}` (stderr; stdout with an explicit `--format json`). */
export type ErrorOutput = {error: ErrorInfo};

/**
 * `run --script` / `check --script` file: the actions, in order. Either the
 * object form (with `$schema` for editors and agents) or a bare array.
 */
export type Script = ScriptFile | Action[];

/** Object form of a script file. */
export type ScriptFile = {
  /** Path or URL of this schema (schema/script.json), e.g. `./node_modules/react-native-a11y-tree/schema/script.json`. */
  $schema?: string;
  /** The actions, in order. */
  actions: Action[];
};

/** `check --rules` file. */
export type RulesFile = {$schema?: string; rules: Rules};

/** `a11y-tree.json` in the project root. */
export type ProjectConfigFile = ProjectConfig & {$schema?: string};

// --- session -------------------------------------------------------------------------

/** Echoed in the response. */
export type RequestId = string | number | null;

/** Output options for the tree in `tree` and `snapshot` responses. */
export type SessionTreeOptions = {
  format?: Format;
  select?: string | string[];
  depth?: number;
  subtree?: string;
  style?: boolean;
};

export type SessionActionRequest = SessionTreeOptions & {id: RequestId; action: Action; diff?: boolean};
export type SessionTreeRequest = SessionTreeOptions & {id: RequestId; tree: true};
export type SessionQuitRequest = {id: RequestId; quit: true};

/** One line on the session's stdin. */
export type SessionRequest = SessionActionRequest | SessionTreeRequest | SessionQuitRequest;

/** First line on the session's stdout. */
export type SessionReady =
  | {
      ready: true;
      tree: TreeNode | null;
      capabilities: string[];
      /** Where the host came from; `version` / `protocolVersion` from its host-version.json when it has one. */
      host?: {source: 'env' | 'package' | 'download' | 'dist'; version?: string; protocolVersion?: number};
      /** The host's own build info (getHostInfo). */
      hostInfo?: HostRuntimeInfo;
      logs?: LogEntry[];
    }
  | {ready: false; error: ErrorInfo; logs?: LogEntry[]};

/** One line on the session's stdout per request. */
export type SessionResponse = {
  id: RequestId;
  ok: boolean;
  error?: ErrorInfo;
  step?: Step;
  /**
   * `tree` requests and `snapshot` actions: a TreeNode (`json`), a list of
   * matches (`select`), compact nodes (`compact`), or a string (`text`, `ndjson`).
   */
  tree?: TreeNode | TreeNode[] | Record<string, unknown> | Array<Record<string, unknown>> | string;
  /** Action requests with `diff: true`. */
  diff?: TreeDiff;
  fallbacks?: string[];
  logs?: LogEntry[];
};

/** Any line on the session's stdout. */
export type SessionOutputLine = SessionReady | SessionResponse;
