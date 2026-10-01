import path from 'node:path';
import {describe, expect, it} from 'vitest';

import type {RenderResult} from '../src/schema.ts';
import {cli, cliJson, E2E_PRESETS, findAll, get, hostSkip, isIOS, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');

describe('render', () => {
  it.for(E2E_PRESETS)('[$name] render examples/basic/App.tsx', {timeout: 180_000}, (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const result = cliJson<RenderResult>(['render', APP], preset);
    const {width, height} = preset;
    expect(result.viewport).toStrictEqual({width, height});
    expect(result.root.box.width).toBe(width);

    const submit = get(result.root, 'submit');
    expect([submit.box.x, submit.box.width, submit.box.height]).toStrictEqual([24, width - 48, 48]);

    const texts = findAll(result.root, n => n.type === 'Paragraph');
    expect(texts.some(n => n.text === 'Sign in'), `title text not found in ${JSON.stringify(texts.map(n => n.text))}`).toBeTruthy();
    expect(result.source).toBe('shadowTree');
    // Full hierarchy: the container View holds the screen content.
    const container = result.root.children[0];
    expect(container?.type).toBe('View');
    expect(container.children.length, 'container View has no children').toBeGreaterThan(0);
    // `role="button"` (ARIA prop) is visible in the shadow tree.
    expect(submit.role).toBe('button');
    expect(submit.children.some(c => c.type === 'Paragraph'), 'submit has no Paragraph child').toBeTruthy();
    for (const text of texts) {
      expect(text.box.height, `Paragraph "${text.text}" has height ${text.box.height}`).toBeGreaterThan(10);
    }

    // TextInput and Switch: the platform's own components (AndroidTextInput /
    // AndroidSwitch, TextInput / Switch). Roles and names come from the JS props.
    const email = get(result.root, 'email');
    const remember = get(result.root, 'remember');
    expect(email.type).toBe(isIOS(preset) ? 'TextInput' : 'AndroidTextInput');
    expect(remember.type).toBe(isIOS(preset) ? 'Switch' : 'AndroidSwitch');
    expect(email.role).toBe('textbox');
    expect(remember.role).toBe('switch');
    expect(remember.name).toBe('Remember me');
    expect(remember.a11y.state?.checked).toBe(true);
    // Both platforms measure TextInput with CoreText; the Switch is 51x31.
    expect(email.box.height).toBe(36.333);
    expect(email.style.placeholder).toBe('Email');
    expect([remember.box.width, remember.box.height]).toStrictEqual([51, 31]);

    // Agent formats on the real host.
    const text = cli(['render', APP, '--format', 'text', '--select', 'role=button'], preset);
    expect(text.status, text.stderr).toBe(0);
    expect(text.stdout.trim()).toMatch(new RegExp(`^submit View #submit role=button "Submit" \\{24,[\\d.]+,${width - 48}x48\\}$`));
  });

  // A preset outside the matrix (tablet): the platform and viewport come from it.
  it('[android-tablet] render examples/basic/App.tsx --select role=button', {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const tablet = cli(['render', APP, '--format', 'text', '--select', 'role=button'], {name: 'android-tablet'} as never);
    expect(tablet.status, tablet.stderr).toBe(0);
    expect(tablet.stdout.trim()).toMatch(/^submit View #submit role=button "Submit" \{24,[\d.]+,752x48\}$/);
  });
});
