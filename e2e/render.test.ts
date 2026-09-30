import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'vitest';

import type {RenderResult} from '../src/schema.ts';
import {cli, cliJson, E2E_PRESETS, findAll, get, hostSkip, isIOS, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');

for (const preset of E2E_PRESETS) {
  test(`[${preset.name}] render examples/basic/App.tsx`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const result = cliJson<RenderResult>(['render', APP], preset);
    const {width, height} = preset;
    assert.deepEqual(result.viewport, {width, height});
    assert.equal(result.root.box.width, width);

    const submit = get(result.root, 'submit');
    assert.deepEqual([submit.box.x, submit.box.width, submit.box.height], [24, width - 48, 48]);

    const texts = findAll(result.root, n => n.type === 'Paragraph');
    assert.ok(
      texts.some(n => n.text === 'Sign in'),
      `title text not found in ${JSON.stringify(texts.map(n => n.text))}`,
    );
    assert.equal(result.source, 'shadowTree');
    // Full hierarchy: the container View holds the screen content.
    const container = result.root.children[0];
    assert.equal(container?.type, 'View');
    assert.ok(container.children.length > 0, 'container View has no children');
    // `role="button"` (ARIA prop) is visible in the shadow tree.
    assert.equal(submit.role, 'button');
    assert.ok(submit.children.some(c => c.type === 'Paragraph'), 'submit has no Paragraph child');
    for (const text of texts) {
      assert.ok(text.box.height > 10, `Paragraph "${text.text}" has height ${text.box.height}`);
    }

    // TextInput and Switch: the platform's own components (AndroidTextInput /
    // AndroidSwitch, TextInput / Switch). Roles and names come from the JS props.
    const email = get(result.root, 'email');
    const remember = get(result.root, 'remember');
    assert.equal(email.type, isIOS(preset) ? 'TextInput' : 'AndroidTextInput');
    assert.equal(remember.type, isIOS(preset) ? 'Switch' : 'AndroidSwitch');
    assert.equal(email.role, 'textbox');
    assert.equal(remember.role, 'switch');
    assert.equal(remember.name, 'Remember me');
    assert.equal(remember.a11y.state?.checked, true);
    // Both platforms measure TextInput with CoreText; the Switch is 51x31.
    assert.equal(email.box.height, 36.333);
    assert.equal(email.style.placeholder, 'Email');
    assert.deepEqual([remember.box.width, remember.box.height], [51, 31]);

    // Agent formats on the real host.
    const text = cli(['render', APP, '--format', 'text', '--select', 'role=button'], preset);
    assert.equal(text.status, 0, text.stderr);
    assert.match(
      text.stdout.trim(),
      new RegExp(`^submit View #submit role=button "Submit" \\{24,[\\d.]+,${width - 48}x48\\}$`),
    );
  });
}

// A preset outside the matrix (tablet): the platform and viewport come from it.
test('[android-tablet] render examples/basic/App.tsx --select role=button', {timeout: 180_000}, t => {
  if (hostSkip) t.skip(hostSkip);
  const tablet = cli(['render', APP, '--format', 'text', '--select', 'role=button'], {name: 'android-tablet'} as never);
  assert.equal(tablet.status, 0, tablet.stderr);
  assert.match(tablet.stdout.trim(), /^submit View #submit role=button "Submit" \{24,[\d.]+,752x48\}$/);
});
