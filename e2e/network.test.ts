import {execFile} from 'node:child_process';
import fs from 'node:fs';
import {createServer} from 'node:http';
import path from 'node:path';
import {promisify} from 'node:util';
import {expect, it} from 'vitest';
import {CLI, hostBin, hostSkip, ROOT} from './helpers.ts';

const exec = promisify(execFile);

it('the headless host uses CLI fetch and replays a recorded response', {timeout: 180_000}, async t => {
  if (hostSkip) t.skip(hostSkip);
  let calls = 0;
  const server = createServer((_req, response) => { calls++; response.setHeader('content-type', 'application/json'); response.end('{"message":"from network"}'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing server address');
  const dir = fs.mkdtempSync(path.join(ROOT, 'examples/.network-'));
  const app = path.join(dir, 'App.tsx');
  const recording = path.join(dir, 'a11y-tree.network.json');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"network-fixture","private":true}');
  fs.writeFileSync(app, `import React,{useEffect,useState} from 'react'; import {Text,View} from 'react-native'; import {fetch as expoFetch} from 'expo/fetch'; export default function App(){const [value,setValue]=useState('pending');const [expoValue,setExpoValue]=useState('pending'); useEffect(()=>{fetch('http://127.0.0.1:${address.port}/data').then(r=>r.json()).then(x=>setValue(x.message)).catch(e=>setValue('error:'+e.message));expoFetch('http://127.0.0.1:${address.port}/expo').then(r=>r.json()).then(x=>setExpoValue(x.message)).catch(e=>setExpoValue('error:'+e.message))},[]);return <View><Text testID="network-result">{value}</Text><Text testID="expo-network-result">{expoValue}</Text></View>}`);
  const run = async (mode: string) => {
    const result = await exec(process.execPath, [CLI, 'render', app, '--platform', 'android', '--format', 'json', '--network', mode, '--network-file', recording], {
      cwd: ROOT, env: {...process.env, RN_A11Y_HOST_BIN: hostBin}, timeout: 90_000, maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(result.stdout);
  };
  try {
    const recorded = await run('record');
    expect(recorded.root.children).toBeTruthy();
    expect(JSON.stringify(recorded.root)).toContain('from network');
    expect(JSON.stringify(recorded.root)).toContain('expo-network-result');
    expect(calls).toBe(2);
    server.close();
    const replayed = await run('replay');
    expect(JSON.stringify(replayed.root)).toContain('from network');
    expect(calls).toBe(2);
  } finally {
    server.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
