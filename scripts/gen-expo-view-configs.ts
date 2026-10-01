#!/usr/bin/env bun
/**
 * Writes runtime/expo/viewConfigs.json (used by runtime/expo/prelude.ts)
 * from the native worker's tables:
 *
 * - native/tools/expo-view-configs/out/viewConfigs.json: per view, the iOS
 *   and Android `validAttributes` and `directEventTypes` (merged here,
 *   because the platform of the JS component, swift-ui or jetpack-compose,
 *   is not the bundle platform);
 * - native/tests/fantomExpoUIViewConfig.json: the union of all @expo/ui
 *   prop and event names (for views not in the table).
 *
 * `children`, `key`, `ref` and `style` are left out of the attributes (a
 * React element prop fails with "JS Symbols are not convertible to dynamic").
 *
 * Usage: bun scripts/gen-expo-view-configs.ts [--check]
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = path.join(ROOT, 'native', 'tools', 'expo-view-configs', 'out', 'viewConfigs.json');
const UNION = path.join(ROOT, 'native', 'tests', 'fantomExpoUIViewConfig.json');
export const OUT = path.join(ROOT, 'packages/react-native-a11y-tree', 'runtime', 'expo', 'viewConfigs.json');

const EXCLUDED = new Set(['children', 'key', 'ref', 'style']);

type NativeViewConfig = {
  validAttributes?: Record<string, unknown>;
  directEventTypes?: Record<string, {registrationName: string}>;
};
type ViewTable = {views: Record<string, {ios?: NativeViewConfig; android?: NativeViewConfig}>};
type UnionConfig = {validAttributes: string[]; events: string[]};

export function generate(): string {
  const table = (JSON.parse(fs.readFileSync(TABLE, 'utf8')) as ViewTable).views;
  const union = JSON.parse(fs.readFileSync(UNION, 'utf8')) as UnionConfig;
  const views: Record<string, {attributes: string[]; events: string[]}> = {};
  for (const name of Object.keys(table).sort()) {
    const entry = table[name];
    const attributes = new Set<string>();
    const events = new Set<string>();
    for (const platform of ['ios', 'android'] as const) {
      const config = entry[platform];
      if (config == null) continue;
      for (const attribute of Object.keys(config.validAttributes ?? {})) attributes.add(attribute);
      for (const event of Object.values(config.directEventTypes ?? {})) events.add(event.registrationName);
    }
    views[name.replace(/^ViewManagerAdapter_/, '')] = {
      attributes: [...attributes].filter(a => !EXCLUDED.has(a)).sort(),
      events: [...events].sort(),
    };
  }
  const out = {
    generatedBy: 'scripts/gen-expo-view-configs.ts',
    views,
    union: {
      attributes: union.validAttributes.filter(a => !EXCLUDED.has(a)).sort(),
      events: [...union.events].sort(),
    },
  };
  return JSON.stringify(out) + '\n';
}

if (process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = generate();
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== text) {
      console.error(`${path.relative(ROOT, OUT)} is out of date: run bun scripts/gen-expo-view-configs.ts`);
      process.exit(1);
    }
  } else {
    fs.writeFileSync(OUT, text);
    console.error(`wrote ${path.relative(ROOT, OUT)} (${text.length} bytes)`);
  }
}
