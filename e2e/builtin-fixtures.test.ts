import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect, it} from 'vitest';
import {cli, cliJson, hostSkip, ROOT} from './helpers.ts';

it('opt-in Expo fixtures provide in-memory storage and visible native placeholders', {timeout: 180_000}, t => {
  if (hostSkip) t.skip(hostSkip);
  const dir = fs.mkdtempSync(path.join(ROOT, 'examples/.builtin-fixtures-'));
  const app = path.join(dir, 'App.tsx');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"builtin-fixtures","private":true}');
  fs.writeFileSync(app, `import React,{useEffect,useState} from 'react';
import {Text,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WebView from 'react-native-webview';
import MapView,{Marker} from 'react-native-maps';
export default function App(){const [value,setValue]=useState('pending');useEffect(()=>{AsyncStorage.setItem('key','stored').then(()=>AsyncStorage.getItem('key')).then(x=>setValue(String(x)))},[]);return <View><Text testID="stored">{value}</Text><WebView testID="web" source={{uri:'https://example.com'}}/><MapView testID="map"><Marker title="Pin"/></MapView></View>}`);
  try {
    const missing = cli(['render', app, '--platform', 'android', '--format', 'json'], {name: 'android-phone'} as never);
    expect(missing.status).not.toBe(0);
    const result = cliJson<any>(['render', app, '--platform', 'android', '--fixtures', 'expo'], {name: 'android-phone'} as never);
    const tree = JSON.stringify(result.root);
    expect(tree).toContain('stored');
    expect(tree).toContain('WebView content not simulated');
    expect(tree).toContain('Map content not simulated');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({target: 'RNCWebView'}),
      expect.objectContaining({target: 'MapView'}),
    ]));
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
