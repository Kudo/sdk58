/**
 * Access to the rendered Fantom root for code that only has React tags
 * (react-native-gesture-handler passes view tags to its native module).
 * No react-native-gesture-handler imports here: the entry always loads it.
 */

import type {RootTag} from 'react-native';
import type ReactNativeDocument from 'react-native/src/private/webapis/dom/nodes/ReactNativeDocument';
import type ReadOnlyElement from 'react-native/src/private/webapis/dom/nodes/ReadOnlyElement';

/** An element of the rendered document with its React tag (a private field). */
export type HostElement = ReadOnlyElement & {readonly __nativeTag?: number};

let rootTag: RootTag | null = null;

export function setRootTag(tag: RootTag): void {
  rootTag = tag;
}

export function getRootTag(): RootTag | null {
  return rootTag;
}

function getDocument(): ReactNativeDocument | null {
  if (rootTag == null) return null;
  const ReactFabric = (
    require('react-native/Libraries/Renderer/shims/ReactFabric') as typeof import('react-native/Libraries/Renderer/shims/ReactFabric')
  ).default;
  // In Fantom the public root instance is the ReactNativeDocument.
  return ReactFabric.getPublicInstanceFromRootTag(rootTag as unknown as number) as ReactNativeDocument | null;
}

/** The ReactNativeElement with this tag in the rendered document, or null. */
export function findElementByTag(tag: number): HostElement | null {
  const document = getDocument();
  if (document == null) return null;
  const stack: Array<HostElement | null | undefined> = [document.documentElement];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node == null) continue;
    if (node.__nativeTag === tag) return node;
    const children = node.children;
    if (children != null) {
      for (let i = 0; i < children.length; i++) stack.push(children[i]);
    }
  }
  return null;
}
