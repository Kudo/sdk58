import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect, it} from 'vitest';
import {renderEntry} from '../packages/react-native-a11y-tree/src/bundle.ts';

it('uses the selected app Nitro metadata and never substitutes the tool dependency', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nitro-entry-'quoted-")));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"isolated-app"}');
    const options = {projectRoot: root, appPath: path.join(root, 'App.tsx'), setupPath: path.join(root, 'fixtures.ts'), viewportWidth: 300, viewportHeight: 600};
    expect(renderEntry(options)).toContain('nitroVersion: undefined');
    const dir = path.join(root, 'node_modules/react-native-nitro-modules');
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"react-native-nitro-modules","version":"0.37.1"}');
    const entry = renderEntry(options);
    const quoted = JSON.stringify(path.join(dir, 'package.json')).slice(1, -1).replaceAll("'", "\\'");
    expect(entry).toContain(`nitroVersion: () => require('${quoted}').version`);
    expect(renderEntry({...options, setupPath: undefined})).not.toContain('react-native-nitro-modules');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
