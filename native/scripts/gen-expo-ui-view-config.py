#!/usr/bin/env python3
# Generates the union view config of @expo/ui for the host's JS
# `globalThis.expo.getViewConfig` (see native/README.md "Expo UI"):
#   {"validAttributes": [prop names], "events": [onX event names]}
# Props: Swift `@Field var name` / `@Field("key")`, Kotlin `*Props` data class
# parameters; events: Swift `var onX = EventDispatcher`, Kotlin
# `val onX by Event` and `Events("onX", ...)`. React-reserved names
# (children, key, ref) and style are removed.
#
# Usage: native/scripts/gen-expo-ui-view-config.py node_modules/@expo/ui > native/tests/fantomExpoUIViewConfig.json
import re, os, json, sys
root = sys.argv[1]  # node_modules/@expo/ui
props, events = set(['modifiers', 'testID']), set(['onGlobalEvent'])
for d, _, files in os.walk(root):
    rel = os.path.relpath(d, root)
    if rel.startswith('build') or 'node_modules' in rel:
        continue
    for f in files:
        p = os.path.join(d, f)
        if f.endswith('.swift'):
            t = open(p, errors='replace').read()
            for m in re.finditer(r'@Field\s*(?:\(\s*"(\w+)"\s*\))?\s*(?:public\s+)?var\s+(\w+)', t):
                props.add(m.group(1) or m.group(2))
            for m in re.finditer(r'\bvar\s+(on[A-Z]\w*)\s*=\s*EventDispatcher', t):
                events.add(m.group(1))
            for m in re.finditer(r'EventDispatcher\(\s*"(on\w+)"', t):
                events.add(m.group(1))
        elif f.endswith('.kt'):
            t = open(p, errors='replace').read()
            for m in re.finditer(r'data class \w+Props?\s*\((.*?)\)\s*(?::|\{|\n)', t, re.S):
                for pm in re.finditer(r'\bva[lr]\s+(\w+)\s*:', m.group(1)):
                    props.add(pm.group(1))
            for m in re.finditer(r'\bval\s+(on[A-Z]\w*)\s+by\s+Event', t):
                events.add(m.group(1))
            for m in re.finditer(r'Events\(([^)]*)\)', t):
                for e in re.findall(r'"(on\w+)"', m.group(1)):
                    events.add(e)
props -= events
# React-reserved props and props React Native already handles (style).
props -= {'children', 'key', 'ref', 'style'}
print(json.dumps({'validAttributes': sorted(props), 'events': sorted(events)}, indent=1))
