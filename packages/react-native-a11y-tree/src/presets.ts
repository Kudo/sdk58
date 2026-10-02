/**
 * Device presets and the optional project config file (`a11y-tree.json` in
 * the directory of the app's nearest package.json).
 *
 * Precedence for each setting: command-line flag > a11y-tree.json > preset
 * (from `--preset` or the config's `preset`) > built-in default.
 */

import fs from 'node:fs';
import path from 'node:path';

import {type Rules, validateRules} from './check.ts';
import {usage} from './errors.ts';

export type Insets = {top: number; left: number; right: number; bottom: number};

export type Settings = {
  platform?: string;
  width?: number;
  height?: number;
  safeAreaInsets?: Insets;
  headerHeight?: number;
  /** Device pixel ratio (PixelRatio.get(), Dimensions scale). */
  scale?: number;
  /** Font scale (PixelRatio.getFontScale()). */
  fontScale?: number;
  tapMode?: string;
  format?: string;
};

export type PresetName = 'android-phone' | 'ios-phone' | 'android-tablet' | 'ios-tablet';

/**
 * Viewports in dp. Android: Pixel 8 (412x915, status bar 24 dp, 56 dp
 * toolbar) and Pixel Tablet portrait (800x1280, 64 dp toolbar). iOS: iPhone
 * 15/16 (393x852, safe area 59/34, 44 dp navigation bar) and iPad 11"
 * portrait (834x1194, safe area 24/20, 50 dp navigation bar). Scale: 3 for
 * phones, 2 for tablets; font scale 1.
 */
export const PRESETS: Record<PresetName, Required<Omit<Settings, 'tapMode' | 'format'>>> = {
  'android-phone': {
    platform: 'android',
    width: 412,
    height: 915,
    safeAreaInsets: {top: 24, left: 0, right: 0, bottom: 0},
    headerHeight: 56,
    scale: 3,
    fontScale: 1,
  },
  'ios-phone': {
    platform: 'ios',
    width: 393,
    height: 852,
    safeAreaInsets: {top: 59, left: 0, right: 0, bottom: 34},
    headerHeight: 44,
    scale: 3,
    fontScale: 1,
  },
  'android-tablet': {
    platform: 'android',
    width: 800,
    height: 1280,
    safeAreaInsets: {top: 24, left: 0, right: 0, bottom: 0},
    headerHeight: 64,
    scale: 2,
    fontScale: 1,
  },
  'ios-tablet': {
    platform: 'ios',
    width: 834,
    height: 1194,
    safeAreaInsets: {top: 24, left: 0, right: 0, bottom: 20},
    headerHeight: 50,
    scale: 2,
    fontScale: 1,
  },
};

export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

export const CONFIG_FILE = 'a11y-tree.json';

const CONFIG_KEYS = [
  '$schema',
  'setup',
  'metroConfig',
  'failOnFallback',
  'allowFallback',
  'preset',
  'platform',
  'width',
  'height',
  'safeAreaInsets',
  'headerHeight',
  'scale',
  'fontScale',
  'tapMode',
  'format',
  'rules',
];

/** `rules` are the default rules for `check` (same shape as a rules file's `rules`). */
export type ProjectConfig = Settings & {
  preset?: PresetName;
  rules?: Rules;
  /** Native fixture module, resolved relative to a11y-tree.json. */
  setup?: string;
  /** Opt-in Metro configuration path, relative to the project root. */
  metroConfig?: string;
  failOnFallback?: boolean;
  /** Exact names of reviewed native/runtime fallbacks or application fixtures. */
  allowFallback?: string[];
};

function checkPreset(name: unknown, where: string): PresetName {
  if (typeof name !== 'string' || !PRESET_NAMES.includes(name as PresetName)) {
    throw usage(`${where}: unknown preset ${JSON.stringify(name)} (one of: ${PRESET_NAMES.join(', ')})`);
  }
  return name as PresetName;
}

/** Reads and validates `a11y-tree.json` in `projectRoot`, or returns null. */
export function loadProjectConfig(projectRoot: string): ProjectConfig | null {
  const file = path.join(projectRoot, CONFIG_FILE);
  if (!fs.existsSync(file)) return null;
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw usage(`${file} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof json !== 'object' || json == null || Array.isArray(json)) {
    throw usage(`${file} must be a JSON object`);
  }
  const config = json as Record<string, unknown>;
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.includes(key)) {
      throw usage(`${file}: unknown key "${key}" (allowed: ${CONFIG_KEYS.join(', ')})`);
    }
  }
  if ('preset' in config) checkPreset(config.preset, file);
  for (const key of ['width', 'height', 'headerHeight']) {
    if (key in config && !(typeof config[key] === 'number' && (config[key] as number) >= 0)) {
      throw usage(`${file}: "${key}" must be a number >= 0`);
    }
  }
  for (const key of ['scale', 'fontScale']) {
    if (key in config && !(typeof config[key] === 'number' && (config[key] as number) > 0)) {
      throw usage(`${file}: "${key}" must be a number > 0`);
    }
  }
  if ('safeAreaInsets' in config) {
    const insets = config.safeAreaInsets as Record<string, unknown>;
    const ok =
      typeof insets === 'object' &&
      insets != null &&
      ['top', 'left', 'right', 'bottom'].every(k => typeof insets[k] === 'number');
    if (!ok) throw usage(`${file}: "safeAreaInsets" must be {top, left, right, bottom} numbers`);
  }
  for (const key of ['platform', 'tapMode', 'format']) {
    if (key in config && typeof config[key] !== 'string') throw usage(`${file}: "${key}" must be a string`);
  }
  for (const key of ['$schema', 'setup', 'metroConfig']) {
    if (key in config && (typeof config[key] !== 'string' || !(config[key] as string).trim())) {
      throw usage(`${file}: "${key}" must be a non-empty string`);
    }
  }
  if ('failOnFallback' in config && typeof config.failOnFallback !== 'boolean') {
    throw usage(`${file}: "failOnFallback" must be a boolean`);
  }
  if ('allowFallback' in config && (!Array.isArray(config.allowFallback) ||
    !config.allowFallback.every(value => typeof value === 'string' && value.trim().length > 0))) {
    throw usage(`${file}: "allowFallback" must be an array of non-empty strings`);
  }
  if ('rules' in config) validateRules(config.rules, `${file}: "rules"`);
  return config as ProjectConfig;
}

/**
 * Merges settings. `explicit` holds the values given on the command line
 * (undefined when not given); the result fills the gaps from the config
 * file, then the preset.
 */
export function resolveSettings(
  explicit: Settings & {preset?: string},
  config: ProjectConfig | null,
): Settings & {preset?: PresetName} {
  const presetName =
    explicit.preset != null
      ? checkPreset(explicit.preset, '--preset')
      : config?.preset != null
        ? config.preset
        : undefined;
  const preset = presetName != null ? PRESETS[presetName] : undefined;
  const pick = <K extends keyof Settings>(key: K): Settings[K] =>
    explicit[key] ?? config?.[key] ?? (preset as Settings | undefined)?.[key];
  return {
    preset: presetName,
    platform: pick('platform'),
    width: pick('width'),
    height: pick('height'),
    safeAreaInsets: pick('safeAreaInsets'),
    headerHeight: pick('headerHeight'),
    scale: pick('scale'),
    fontScale: pick('fontScale'),
    tapMode: pick('tapMode'),
    format: pick('format'),
  };
}
