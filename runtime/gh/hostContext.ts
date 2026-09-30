/**
 * Access to the rendered Fantom root for code that only has React tags
 * (react-native-gesture-handler passes view tags to its native module).
 * No react-native-gesture-handler imports here: the entry always loads it.
 */

let rootTag = null;

export function setRootTag(tag) {
  rootTag = tag;
}

export function getRootTag() {
  return rootTag;
}

function getDocument() {
  if (rootTag == null) return null;
  const ReactFabric = require('react-native/Libraries/Renderer/shims/ReactFabric').default;
  return ReactFabric.getPublicInstanceFromRootTag(rootTag);
}

/** The ReactNativeElement with this tag in the rendered document, or null. */
export function findElementByTag(tag) {
  const document = getDocument();
  if (document == null) return null;
  const stack = [document.documentElement];
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
