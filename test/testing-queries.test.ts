import {describe, expect, it} from 'vitest';
import {isElementDisabled, isElementVisible, matchesText, queryNodes, textContent} from '../packages/react-native-a11y-tree/src/testingQueries.ts';
import type {TreeNode} from '../packages/react-native-a11y-tree/src/schema.ts';

function node(overrides: Partial<TreeNode> = {}): TreeNode {
  return {ref: 'n0', key: 'root', sel: 'RootView', type: 'View', role: null, name: null, text: null,
    testID: null, a11y: {}, style: {}, box: {x: 0, y: 0, width: 100, height: 48}, children: [], ...overrides};
}

describe('Testing Library queries over host trees', () => {
  it('should match role and accessible name with string and regex queries', () => {
    const button = node({role: 'button', name: 'Save note', testID: 'save', a11y: {accessible: true}});
    const root = node({children: [button]});
    expect(queryNodes(root, 'Role', 'button', {name: /Save/})).toEqual([button]);
    expect(queryNodes(root, 'TestId', /^sav/)).toEqual([button]);
    expect(queryNodes(root, 'Role', 'button', {name: 'save note'})).toEqual([]);
    expect(queryNodes(root, 'Role', 'button', {disabled: false})).toEqual([button]);
  });

  it('should distinguish content from the accessible label', () => {
    const label = node({type: 'Paragraph', text: 'Save', role: 'text'});
    const button = node({name: 'Save note', a11y: {label: 'Save note'}, children: [label]});
    expect(textContent(button)).toBe('Save');
    expect(queryNodes(button, 'Text', 'Save')).toEqual([label]);
    expect(queryNodes(button, 'LabelText', 'Save note')).toEqual([button]);
  });

  it('should normalize whitespace and reuse stateful regular expressions', () => {
    expect(matchesText('  Save\n  note  ', 'Save note')).toBe(true);
    const regex = /note/g;
    regex.lastIndex = 20;
    expect(matchesText('note', regex)).toBe(true);
    expect(matchesText('note', regex)).toBe(true);
    expect(matchesText(null, '')).toBe(false);
  });

  it('should exclude hidden descendants and covered stack screens by default', () => {
    const hidden = node({testID: 'hidden'});
    const old = node({type: 'RNSScreen', testID: 'old'});
    const active = node({type: 'RNSScreen', testID: 'active'});
    const root = node({children: [node({a11y: {hidden: true}, children: [hidden]}), node({type: 'RNSScreenStack', children: [old, active]})]});
    expect(queryNodes(root, 'TestId', 'hidden')).toEqual([]);
    expect(queryNodes(root, 'TestId', 'old')).toEqual([]);
    expect(isElementVisible(root, old)).toBe(false);
    expect(isElementVisible(root, active)).toBe(true);
    expect(queryNodes(root, 'TestId', 'active')).toEqual([active]);
    expect(queryNodes(root, 'TestId', /hidden|old/, {includeHiddenElements: true})).toEqual([hidden, old]);
  });

  it('should preserve child accessibility when only its parent is excluded', () => {
    const child = node({testID: 'child'});
    const root = node({a11y: {hidden: true, raw: {importantForAccessibility: 'no'}}, children: [child]});
    expect(queryNodes(root, 'TestId', 'child')).toEqual([child]);
    expect(isElementVisible(root, child)).toBe(true);
  });

  it('should inherit disabled state and visibility from ancestors', () => {
    const child = node({role: 'button', a11y: {accessible: true}});
    const root = node({a11y: {state: {disabled: true}}, effectiveOpacity: 0, children: [child]});
    expect(isElementDisabled(root, child)).toBe(true);
    expect(queryNodes(root, 'Role', 'button', {disabled: true})).toEqual([child]);
    expect(isElementVisible(root, child)).toBe(false);
  });

  it('should retain duplicates for cardinality checks and avoid duplicate span text', () => {
    const text = node({type: 'Paragraph', text: 'Hello', children: [node({text: 'Hello'})]});
    const root = node({children: [node({testID: 'same'}), node({testID: 'same'}), text]});
    expect(queryNodes(root, 'TestId', 'same')).toHaveLength(2);
    expect(textContent(text)).toBe('Hello');
  });
});
