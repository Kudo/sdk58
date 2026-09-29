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
  /** Raw accessibility-related props as reported by the host (string values). */
  raw?: Record<string, string>;
};

export type TreeNode = {
  /** Stable id within one render: `n0`, `n1`, ... in pre-order. */
  ref: string;
  /** Host component name from the shadow tree: `View`, `Paragraph`, `Image`, `Text` (text fragment), ... */
  type: string;
  /**
   * Selector for this node. `#testID` when a testID is set, otherwise a path
   * of types with 1-based sibling indices, e.g. `RootView>View>Paragraph:2`.
   */
  sel: string;
  /** Accessibility role (`button`, `image`, `header`, `text`, ...) or `null`. */
  role: string | null;
  /** Accessible name: label, else aria-label, else text content. */
  name: string | null;
  a11y: A11yInfo;
  /** Absolute frame in dp (sum of parent frames). */
  box: Box;
  /** Non-a11y, non-layout props reported by the host (string values). */
  style: Record<string, string>;
  /** Text content for `Paragraph` / `Text` nodes, else `null`. */
  text: string | null;
  testID: string | null;
  children: TreeNode[];
};

export type RenderResult = {
  viewport: {width: number; height: number};
  root: TreeNode;
};

/** Raw shape produced by Fantom's native `RenderOutput::renderView`. */
export type FantomNode = {
  type: string;
  props: Record<string, string>;
  children: Array<FantomNode | string> | string;
};

/** Payload the JS entry prints inside `{"type":"rn-a11y-tree-result","rnA11yTree":...}`. */
export type HostPayload = {
  viewport: {width: number; height: number};
  tree: FantomNode;
};
