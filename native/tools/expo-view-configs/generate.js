#!/usr/bin/env node
// Generates the view configs (props and events) of @expo/ui's native views from the Swift and
// Kotlin sources, so a host without the Expo native runtime can answer
// `globalThis.expo.getViewConfig(moduleName, viewName)`.
//
// Usage:
//   node native/tools/expo-view-configs/generate.js [--src <expo checkout>] [--ref <git ref>]
//        [--expo-repo <path>] [--out <file>]
//
// Sources, in this order:
//   --src <dir>            an Expo checkout (a worktree of the ref); default /tmp/expo-sdk58 if it exists
//   --expo-repo + --ref    `git show <ref>:<path>` in that repo (default ~/Developer/expo, origin/sdk-58)
//
// What native does (sdk-58), and what this script copies:
// - iOS `CoreModule.getViewConfig` (expo-modules-core/ios/Core/Modules/CoreModule.swift): prop names
//   are the `@Field` properties of the view's props class (the key, else the property name), event
//   names are its `EventDispatcher` properties (custom name, else the property name), including
//   `ExpoSwiftUI.ViewProps.globalEventDispatcher` = `onGlobalEvent` (SwiftUIViewProps.swift).
//   Event keys use `RCTNormalizeInputEventName`: `onX` -> `topX`, else `top` + capitalized name.
// - Android `CoreModule.getViewConfig` (defaultmodules/CoreModule.kt): props of the view definition,
//   events of its callbacks definition. `ExpoUIView<Props>("Name") { val x by Event<T>() }` views
//   always have `onGlobalEvent` (ComposeViewEventDefinitionBuilder); class-based
//   `View(X::class) { Events(...) }` views have only the listed events. Event keys use
//   `normalizeEventName` (KModuleEventEmitterWrapper.kt): `onX` -> `topX`, else unchanged.
//   Class-based Compose views also get the React Native CSS border props (`UseCSSProps`), which
//   are not listed here (`cssProps: true`).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXPO_UI = 'packages/expo-ui';
const MODULE_NAME = 'ExpoUI';

// ---------------------------------------------------------------------------------------------
// Arguments and sources

function parseArgs(argv) {
  const args = {
    src: null,
    ref: 'origin/sdk-58',
    expoRepo: path.join(os.homedir(), 'Developer/expo'),
    out: path.join(__dirname, 'out/viewConfigs.json'),
  };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    const value = argv[i + 1];
    if (name === '--src') args.src = value;
    else if (name === '--ref') args.ref = value;
    else if (name === '--expo-repo') args.expoRepo = value;
    else if (name === '--out') args.out = value;
    else if (name === '-h' || name === '--help') {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 12).join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${name}`);
    }
    i++;
  }
  if (!args.src && fs.existsSync('/tmp/expo-sdk58/packages/expo-ui')) {
    args.src = '/tmp/expo-sdk58';
  }
  return args;
}

/** Returns { describe, list(dir, ext), read(file) } over a checkout or a git ref. */
function openSources(args) {
  if (args.src) {
    const root = path.resolve(args.src);
    return {
      describe: root,
      list(dir, ext) {
        const out = [];
        const walk = (d) => {
          for (const entry of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
            const rel = path.posix.join(d, entry.name);
            if (entry.isDirectory()) walk(rel);
            else if (rel.endsWith(ext)) out.push(rel);
          }
        };
        walk(dir);
        return out.sort();
      },
      read: (file) => fs.readFileSync(path.join(root, file), 'utf8'),
    };
  }
  const git = (...gitArgs) =>
    execFileSync('git', ['-C', args.expoRepo, ...gitArgs], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return {
    describe: `${args.expoRepo} @ ${args.ref}`,
    list: (dir, ext) =>
      git('ls-tree', '-r', '--name-only', args.ref, dir)
        .split('\n')
        .filter((f) => f.endsWith(ext))
        .sort(),
    read: (file) => git('show', `${args.ref}:${file}`),
  };
}

// ---------------------------------------------------------------------------------------------
// Shared parsing helpers

/** Replaces comments with spaces (keeps offsets and line numbers), respecting string literals. */
function stripComments(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (c === '"') {
      // String literal (also covers the first quote of a """ block well enough for our sources).
      let j = i + 1;
      while (j < code.length && code[j] !== '"' && code[j] !== '\n') {
        if (code[j] === '\\') j++;
        j++;
      }
      out += code.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && next === '/') {
      let j = i;
      while (j < code.length && code[j] !== '\n') j++;
      out += ' '.repeat(j - i);
      i = j;
    } else if (c === '/' && next === '*') {
      let j = i + 2;
      while (j < code.length && !(code[j] === '*' && code[j + 1] === '/')) j++;
      out += code.slice(i, j + 2).replace(/[^\n]/g, ' ');
      i = j + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Index of the bracket that closes the one at `open`. */
function matchBracket(code, open) {
  const pairs = { '{': '}', '(': ')', '<': '>' };
  const openChar = code[open];
  const closeChar = pairs[openChar];
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '"') {
      i++;
      while (i < code.length && code[i] !== '"') {
        if (code[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (code[i] === openChar) depth++;
    else if (code[i] === closeChar && --depth === 0) return i;
  }
  return -1;
}

/** The text of a block body with nested blocks blanked, so only its own members remain. */
function topLevel(body) {
  let out = '';
  let depth = 0;
  for (const c of body) {
    if (c === '{') depth++;
    if (depth === 0 || c === '\n') out += c;
    else out += ' ';
    if (c === '}') depth--;
  }
  return out;
}

function lineOf(code, index) {
  return code.slice(0, index).split('\n').length;
}

/** Splits on top-level commas (not inside (), <>, [], {}). */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('([{<'.includes(c)) depth++;
    else if (')]}>'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function inferType(defaultValue) {
  if (defaultValue == null) return null;
  const v = defaultValue.trim();
  if (v === 'true' || v === 'false') return 'Bool';
  if (/^-?\d+$/.test(v)) return 'Int';
  if (/^-?\d*\.\d+$/.test(v)) return 'Double';
  if (/^".*"$/.test(v)) return 'String';
  const call = v.match(/^([A-Z][\w.]*)\(/);
  return call ? call[1] : null;
}

const iosEventKey = (name) =>
  name.startsWith('on')
    ? 'top' + name.slice(2)
    : name.startsWith('top')
      ? name
      : 'top' + name[0].toUpperCase() + name.slice(1);
const androidEventKey = (name) => (name.startsWith('on') ? 'top' + name.slice(2) : name);

function viewConfig(props, events, eventKey) {
  const validAttributes = {};
  for (const prop of props) validAttributes[prop.name] = true;
  const directEventTypes = {};
  for (const event of events) directEventTypes[eventKey(event.name)] = { registrationName: event.name };
  return { validAttributes, directEventTypes };
}

// ---------------------------------------------------------------------------------------------
// iOS (Swift)

function parseSwift(sources, warnings) {
  const files = sources.list(`${EXPO_UI}/ios`, '.swift');
  const types = new Map(); // name -> { file, code, body, bases, kind, line }
  for (const file of files) {
    const code = stripComments(sources.read(file));
    const declRe =
      /\b(struct|class|enum|extension)\s+([A-Za-z_][\w.]*)(\s*<[^{]*?>)?\s*(?::\s*([^{]+?))?\s*(?:where [^{]+)?\{/g;
    let m;
    while ((m = declRe.exec(code))) {
      if (m[1] === 'extension') continue;
      const open = m.index + m[0].length - 1;
      const close = matchBracket(code, open);
      if (close < 0) continue;
      const name = m[2].split('.').pop();
      if (!types.has(name)) {
        types.set(name, {
          kind: m[1],
          file,
          code,
          line: lineOf(code, m.index),
          bases: m[4] ? splitTopLevel(m[4]) : [],
          body: code.slice(open + 1, close),
          bodyOffset: open + 1,
        });
      }
    }
  }

  // Registrations in ExpoUIModule.swift: View(X.self) and ExpoUIView(X.self).
  const moduleFile = `${EXPO_UI}/ios/ExpoUIModule.swift`;
  const moduleCode = stripComments(sources.read(moduleFile));
  const regRe = /\b(View|ExpoUIView)\(\s*([\w.]+)\.self/g;
  const registrations = [];
  let m;
  while ((m = regRe.exec(moduleCode))) {
    registrations.push({ dsl: m[1], typeName: m[2], line: lineOf(moduleCode, m.index) });
  }

  function propsOf(className, seen = new Set()) {
    if (seen.has(className)) return { props: [], events: [] };
    seen.add(className);
    if (className === 'ExpoSwiftUI.ViewProps' || className === 'ViewProps') {
      return {
        props: [],
        events: [
          {
            name: 'onGlobalEvent',
            source: 'expo-modules-core/ios/Core/Views/SwiftUI/SwiftUIViewProps.swift (globalEventDispatcher)',
          },
        ],
      };
    }
    const type = types.get(className);
    if (!type) {
      warnings.push(`ios: props class ${className} not found`);
      return { props: [], events: [] };
    }
    const own = topLevel(type.body);
    const props = [];
    const events = [];
    const source = `${type.file}:${type.line}`;
    const fieldRe =
      /@Field(?:\(\s*"([^"]+)"\s*\))?\s+(?:(?:public|internal|private|fileprivate|open)\s+)*var\s+(\w+)\s*(?::\s*([^=\n]+?))?\s*(?:=\s*([^\n]+?))?\s*$/gm;
    let f;
    while ((f = fieldRe.exec(own))) {
      const defaultValue = f[4] ? f[4].trim() : undefined;
      props.push({
        name: f[1] || f[2],
        type: (f[3] && f[3].trim()) || inferType(defaultValue) || 'unknown',
        ...(defaultValue !== undefined ? { default: defaultValue } : {}),
        source,
      });
    }
    const eventRe = /\b(?:var|let)\s+(\w+)\s*(?::\s*EventDispatcher\s*)?=\s*EventDispatcher\(\s*(?:"([^"]+)")?\s*\)/g;
    while ((f = eventRe.exec(own))) {
      events.push({ name: f[2] || f[1], source });
    }
    // Superclass: the first base that is a class we know, or the SwiftUI base props.
    for (const base of type.bases) {
      const baseName = base.replace(/<.*$/, '').trim();
      if (baseName === 'ExpoSwiftUI.ViewProps' || types.get(baseName.split('.').pop())?.kind === 'class') {
        const inherited = propsOf(baseName === 'ExpoSwiftUI.ViewProps' ? baseName : baseName.split('.').pop(), seen);
        props.unshift(...inherited.props);
        events.unshift(...inherited.events);
        break;
      }
    }
    return { props, events };
  }

  const views = {};
  for (const reg of registrations) {
    const viewName = reg.typeName.split('.').pop();
    const type = types.get(viewName);
    if (!type) {
      warnings.push(`ios: view type ${reg.typeName} not found`);
      continue;
    }
    const propsMatch = topLevel(type.body).match(/\bvar\s+props\s*:\s*([\w.]+)/);
    const propsClass = propsMatch ? propsMatch[1] : null;
    const { props, events } = propsClass
      ? propsOf(propsClass.split('.').pop() === 'ViewProps' ? propsClass : propsClass.split('.').pop())
      : { props: [], events: [] };
    if (!propsClass) warnings.push(`ios: ${viewName} has no props class`);
    views[viewName] = {
      viewName,
      typeName: reg.typeName,
      dsl: reg.dsl,
      commonModifiers: reg.dsl === 'ExpoUIView',
      file: `${type.file}:${type.line}`,
      registeredAt: `${moduleFile}:${reg.line}`,
      propsClass,
      props,
      events,
      ...viewConfig(props, events, iosEventKey),
    };
  }
  return views;
}

// ---------------------------------------------------------------------------------------------
// Android (Kotlin)

function parseKotlin(sources, warnings) {
  const files = sources.list(`${EXPO_UI}/android/src/main`, '.kt');
  const classes = new Map(); // name -> { file, code, header, params, body, line }
  for (const file of files) {
    const code = stripComments(sources.read(file));
    const classRe = /\bclass\s+(\w+)(\s*<[^>]*>)?/g;
    let m;
    while ((m = classRe.exec(code))) {
      let i = m.index + m[0].length;
      while (/\s/.test(code[i])) i++;
      // Optional `internal constructor` / annotations before the parameter list.
      const ctor = code.slice(i).match(/^((?:@\w+\s*)*(?:internal|private|public)?\s*constructor\s*)/);
      if (ctor) i += ctor[0].length;
      let params = '';
      if (code[i] === '(') {
        const close = matchBracket(code, i);
        params = code.slice(i + 1, close);
        i = close + 1;
      }
      const headerEnd = code.slice(i).search(/[{\n]\s*\n|\{/);
      const header = code.slice(i, headerEnd < 0 ? code.length : i + headerEnd);
      let body = '';
      const brace = code.indexOf('{', i);
      if (brace >= 0 && brace === i + headerEnd) {
        const close = matchBracket(code, brace);
        body = code.slice(brace + 1, close);
      }
      if (!classes.has(m[1])) {
        classes.set(m[1], { file, code, header, params, body, line: lineOf(code, m.index) });
      }
    }
  }

  function propsOfDataClass(name) {
    const cls = classes.get(name);
    if (!cls) {
      warnings.push(`android: props class ${name} not found`);
      return [];
    }
    const source = `${cls.file}:${cls.line}`;
    return splitTopLevel(cls.params)
      .map((param) => {
        const clean = param.replace(/@[\w.]+(\([^)]*\))?\s*/g, '').trim();
        const p = clean.match(/^(?:override\s+)?(?:val|var)\s+(\w+)\s*:\s*([\s\S]+?)\s*(?:=\s*([\s\S]+))?$/);
        if (!p) return null;
        return {
          name: p[1],
          type: p[2].replace(/\s+/g, ' '),
          ...(p[3] !== undefined ? { default: p[3].replace(/\s+/g, ' ').trim() } : {}),
          source,
        };
      })
      .filter(Boolean);
  }

  const moduleFile = `${EXPO_UI}/android/src/main/java/expo/modules/ui/ExpoUIModule.kt`;
  const moduleCode = stripComments(sources.read(moduleFile));
  const views = {};

  const blockAfter = (index) => {
    let i = index;
    while (/[ \t]/.test(moduleCode[i])) i++;
    if (moduleCode[i] !== '{') return '';
    return moduleCode.slice(i + 1, matchBracket(moduleCode, i));
  };
  const quoted = (text) => [...text.matchAll(/"(\w+)"/g)].map((q) => q[1]);

  // Class-based: View(X::class) { Events(...); Prop("...") }
  const classRe = /\bView\(\s*(\w+)::class\s*\)/g;
  let m;
  while ((m = classRe.exec(moduleCode))) {
    const viewName = m[1];
    const block = blockAfter(m.index + m[0].length);
    const cls = classes.get(viewName);
    const composeProps = cls && cls.header.match(/ExpoComposeView<\s*(\w+)\s*>/);
    const props = composeProps ? propsOfDataClass(composeProps[1]) : [];
    const registeredAt = `${moduleFile}:${lineOf(moduleCode, m.index)}`;
    for (const prop of [...block.matchAll(/\bProp\(\s*"(\w+)"/g)].map((p) => p[1])) {
      props.push({ name: prop, type: 'unknown', source: registeredAt });
    }
    const eventsCall = block.match(/\bEvents\(([^)]*)\)/);
    const events = eventsCall ? quoted(eventsCall[1]).map((name) => ({ name, source: registeredAt })) : [];
    if (!cls) warnings.push(`android: view class ${viewName} not found`);
    views[viewName] = {
      viewName,
      typeName: viewName,
      dsl: 'View(class)',
      file: cls ? `${cls.file}:${cls.line}` : null,
      registeredAt,
      propsClass: composeProps ? composeProps[1] : null,
      cssProps: Boolean(composeProps),
      props,
      events,
      ...viewConfig(props, events, androidEventKey),
    };
  }

  // Functional: ExpoUIView<Props>("Name") { val x by Event<T>() ... }
  const funcRe = /\bExpoUIView<\s*(\w+)\s*>\(\s*"(\w+)"\s*\)/g;
  while ((m = funcRe.exec(moduleCode))) {
    const [, propsClass, viewName] = m;
    const block = blockAfter(m.index + m[0].length);
    const registeredAt = `${moduleFile}:${lineOf(moduleCode, m.index)}`;
    const props = propsOfDataClass(propsClass);
    const events = [
      {
        name: 'onGlobalEvent',
        source: 'expo-modules-core/android/src/compose/.../ModuleDefinitionBuilderComposeExtension.kt (GLOBAL_EVENT_NAME)',
      },
      ...[...topLevel(block).matchAll(/\bval\s+(\w+)\s+by\s+Event\b/g)].map((e) => ({ name: e[1], source: registeredAt })),
    ];
    const cls = classes.get(propsClass);
    views[viewName] = {
      viewName,
      typeName: viewName,
      dsl: 'ExpoUIView',
      file: cls ? `${cls.file}:${cls.line}` : null,
      registeredAt,
      propsClass,
      props,
      events,
      ...viewConfig(props, events, androidEventKey),
    };
  }
  return views;
}

// ---------------------------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = openSources(args);
  const warnings = [];
  const ios = parseSwift(sources, warnings);
  const android = parseKotlin(sources, warnings);

  const views = {};
  for (const [platform, platformViews] of [
    ['ios', ios],
    ['android', android],
  ]) {
    for (const [name, config] of Object.entries(platformViews)) {
      const key = `ViewManagerAdapter_${MODULE_NAME}_${name}`;
      views[key] ??= { moduleName: MODULE_NAME, viewName: name };
      views[key][platform] = config;
    }
  }
  const sortedViews = Object.fromEntries(Object.entries(views).sort(([a], [b]) => a.localeCompare(b)));

  const stat = (platformViews) => ({
    views: Object.keys(platformViews).length,
    props: Object.values(platformViews).reduce((n, v) => n + v.props.length, 0),
    events: Object.values(platformViews).reduce((n, v) => n + v.events.length, 0),
    viewsWithoutProps: Object.values(platformViews)
      .filter((v) => v.props.length === 0)
      .map((v) => v.viewName),
  });

  const output = {
    generatedBy: 'native/tools/expo-view-configs/generate.js',
    source: sources.describe,
    stats: { ios: stat(ios), android: stat(android), keys: Object.keys(sortedViews).length },
    warnings,
    views: sortedViews,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(output, null, 2) + '\n');
  console.error(
    `wrote ${args.out}: ios ${output.stats.ios.views} views / ${output.stats.ios.props} props / ${output.stats.ios.events} events, ` +
      `android ${output.stats.android.views} views / ${output.stats.android.props} props / ${output.stats.android.events} events, ` +
      `${warnings.length} warnings`
  );
}

main();
