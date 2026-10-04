import type {TreeNode} from './schema.ts';

export type TextMatch = string | RegExp;
export type QueryOptions = {
  name?: TextMatch;
  exact?: boolean;
  includeHiddenElements?: boolean;
  disabled?: boolean;
  checked?: boolean | 'mixed';
  selected?: boolean;
};
export type QueryKind = 'TestId' | 'Role' | 'Text' | 'LabelText';

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function matchesText(actual: string | null, expected: TextMatch, exact = true): boolean {
  if (actual == null) return false;
  const text = normalizeText(actual);
  if (typeof expected === 'string') {
    const wanted = normalizeText(expected);
    return exact ? text === wanted : text.toLowerCase().includes(wanted.toLowerCase());
  }
  // Stateful regexes must behave the same on every node and poll.
  return new RegExp(expected.source, expected.flags).test(text);
}

export function textContent(node: TreeNode): string {
  return node.text ?? node.children.map(textContent).filter(Boolean).join(' ');
}

export function flattenTree(root: TreeNode): TreeNode[] {
  return [root, ...root.children.flatMap(flattenTree)];
}

export function elementPath(root: TreeNode, target: TreeNode): TreeNode[] {
  if (root === target) return [root];
  for (const child of root.children) {
    const path = elementPath(child, target);
    if (path.length) return [root, ...path];
  }
  return [];
}

export function isElementVisible(root: TreeNode, target: TreeNode): boolean {
  const path = elementPath(root, target);
  return path.length > 0 && path.every((node, index) => {
    const parent = path[index - 1];
    const covered = node.type === 'RNSScreen' && parent?.type === 'RNSScreenStack' && parent.children.filter(child => child.type === 'RNSScreen').at(-1) !== node;
    const hidden = node.a11y.hidden === true && (node === target || node.a11y.raw?.importantForAccessibility !== 'no');
    return !covered && !hidden && node.style.display !== 'none' && node.effectiveOpacity !== 0;
  });
}

export function isElementDisabled(root: TreeNode, target: TreeNode): boolean {
  return elementPath(root, target).some(node => node.a11y.state?.disabled === true);
}

export function queryNodes(root: TreeNode, kind: QueryKind, match: TextMatch, options: QueryOptions = {}): TreeNode[] {
  const results: TreeNode[] = [];
  const visit = (node: TreeNode, hiddenAncestor: boolean, coveredScreen = false) => {
    const hidden = hiddenAncestor || node.a11y.hidden === true || node.style.display === 'none' || coveredScreen;
    const accessible = node.a11y.accessible === true || ['Paragraph', 'Text', 'TextInput', 'AndroidTextInput', 'Switch', 'AndroidSwitch'].includes(node.type);
    const value = kind === 'TestId' ? node.testID : kind === 'Role' ? node.role : kind === 'LabelText' ? node.a11y.label ?? null : node.text;
    if ((!hidden || options.includeHiddenElements) && (kind !== 'Role' || accessible || node.type.startsWith('ExpoUI.'))
      && matchesText(value, match, options.exact)
      && (options.name === undefined || matchesText(node.name, options.name))
      && (options.disabled === undefined || isElementDisabled(root, node) === options.disabled)
      && (options.selected === undefined || (node.a11y.state?.selected === true) === options.selected)
      && (options.checked === undefined || node.a11y.state?.checked === options.checked)) results.push(node);
    const hidesChildren = hiddenAncestor || coveredScreen || node.style.display === 'none' || (node.a11y.hidden === true && node.a11y.raw?.importantForAccessibility !== 'no');
    const topScreen = node.type === 'RNSScreenStack' ? node.children.filter(child => child.type === 'RNSScreen').at(-1) : undefined;
    for (const child of node.children) visit(child, hidesChildren, topScreen !== undefined && child.type === 'RNSScreen' && child !== topScreen);
  };
  visit(root, false);
  return kind === 'Text' ? results.filter(node => !node.children.some(child => flattenTree(child).some(descendant => results.includes(descendant)))) : results;
}
