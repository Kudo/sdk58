import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import type {RenderResult, TreeNode} from '../src/schema.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');

const DIST_BIN = path.join(ROOT, 'native', 'dist', process.arch === 'x64' ? 'x86_64' : process.arch, 'rn-a11y-host');
const hostBin = process.env.RN_A11Y_HOST_BIN || (fs.existsSync(DIST_BIN) ? DIST_BIN : undefined);

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
      : `no host binary: run \`yarn build:host\` (creates ${path.relative(ROOT, DIST_BIN)}) or set RN_A11Y_HOST_BIN`,
    timeout: 180_000,
  },
  () => {
    const proc = spawnSync(process.execPath, [CLI, 'render', APP, '--platform', 'android'], {
      cwd: ROOT,
      env: {...process.env, RN_A11Y_HOST_BIN: hostBin},
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(proc.status, 0, `CLI failed:\n${proc.stderr}`);

    const result = JSON.parse(proc.stdout) as RenderResult;
    assert.deepEqual(result.viewport, {width: 390, height: 844});
    assert.equal(result.root.box.width, 390);

    const [submit] = findAll(result.root, n => n.testID === 'submit');
    assert.ok(submit, 'node with testID "submit" not found');
    assert.ok(submit.box.width > 0 && submit.box.height > 0, 'submit has an empty box');

    const texts = findAll(result.root, n => n.type === 'Paragraph');
    assert.ok(texts.length > 0, 'no Paragraph (Text) nodes');
    assert.ok(
      texts.some(n => n.text === 'Sign in'),
      `title text not found in ${JSON.stringify(texts.map(n => n.text))}`,
    );

    if (result.source === 'shadowTree') {
      // Full hierarchy: the container View holds the screen content.
      const container = result.root.children[0];
      assert.equal(container?.type, 'View');
      assert.ok(container.children.length > 0, 'container View has no children');
      // `role="button"` (ARIA prop) is visible in the shadow tree.
      assert.equal(submit.role, 'button');
      assert.ok(
        submit.children.some(c => c.type === 'Paragraph'),
        'submit has no Paragraph child',
      );
      for (const t of texts) {
        assert.ok(t.box.height > 10, `Paragraph "${t.text}" has height ${t.box.height}`);
      }

      const [email] = findAll(result.root, n => n.testID === 'email');
      assert.ok(email, 'node with testID "email" not found');
      assert.equal(email.role, 'textbox');
      assert.ok(email.box.height > 18, `email has height ${email.box.height}`);
      assert.equal(email.style.placeholder, 'Email');

      const [remember] = findAll(result.root, n => n.testID === 'remember');
      assert.ok(remember, 'node with testID "remember" not found');
      assert.equal(remember.role, 'switch');
      assert.equal(remember.name, 'Remember me');
      assert.equal(remember.a11y.state?.checked, true);
      assert.equal(remember.box.width, 51);
      assert.equal(remember.box.height, 31);
    } else {
      // Mounted tree (getRenderedOutput): the `role` prop is not in the
      // host's debug props, so only `accessibilityRole` would show a role.
      assert.equal(result.source, 'mounted');
    }

    // Agent formats on the real host.
    const text = spawnSync(
      process.execPath,
      [CLI, 'render', APP, '--platform', 'android', '--format', 'text', '--select', 'role=button'],
      {cwd: ROOT, encoding: 'utf8', env: {...process.env, RN_A11Y_HOST_BIN: hostBin}},
    );
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout.trim(), /^submit View #submit role=button "Submit" \{24,[\d.]+,342x48\}$/);
  },
);
