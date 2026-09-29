import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import type {RenderResult, TreeNode} from '../src/schema.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');

const hostBin = process.env.RN_A11Y_HOST_BIN;

function findAll(node: TreeNode, pred: (n: TreeNode) => boolean): TreeNode[] {
  const out = pred(node) ? [node] : [];
  for (const child of node.children) out.push(...findAll(child, pred));
  return out;
}

test(
  'render examples/basic/App.tsx',
  {
    skip: hostBin
      ? false
      : 'RN_A11Y_HOST_BIN is not set (path to the Fantom host binary)',
    timeout: 180_000,
  },
  () => {
    const proc = spawnSync(process.execPath, [CLI, 'render', APP], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(proc.status, 0, `CLI failed:\n${proc.stderr}`);

    const result = JSON.parse(proc.stdout) as RenderResult;
    assert.deepEqual(result.viewport, {width: 390, height: 844});
    assert.equal(result.root.box.width, 390);

    const [submit] = findAll(result.root, n => n.testID === 'submit');
    assert.ok(submit, 'node with testID "submit" not found');
    assert.equal(submit.role, 'button');
    assert.ok(submit.box.width > 0 && submit.box.height > 0, 'submit has an empty box');

    const texts = findAll(result.root, n => n.type === 'Paragraph');
    assert.ok(texts.length > 0, 'no Paragraph (Text) nodes');
    assert.ok(
      texts.some(n => n.text === 'Sign in'),
      `title text not found in ${JSON.stringify(texts.map(n => n.text))}`,
    );
  },
);
