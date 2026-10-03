import fs from 'node:fs';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {expect, it} from 'vitest';
import {createNetworkBridge} from '../packages/react-native-a11y-tree/src/network.ts';

it('live fetch can be recorded and replayed without a second network call', async () => {
  let calls = 0;
  const server = createServer((_req, res) => {calls++; res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing server address');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-network-'));
  const file = path.join(dir, 'network.json');
  const request = {url: `http://127.0.0.1:${address.port}/data`, method: 'GET', headers: [] as [string, string][], body: null};
  try {
    const record = createNetworkBridge({mode: 'record', file});
    const first = await record.request(request);
    expect(first.status).toBe(200);
    expect(Buffer.from(first.body!, 'base64').toString()).toBe('{"ok":true}');
    expect(calls).toBe(1);
    const replay = createNetworkBridge({mode: 'replay', file});
    expect(await replay.request(request)).toEqual(first);
    expect(calls).toBe(1);
    expect((await replay.request({...request, url: request.url + '/missing'})).error).toContain('NETWORK_NOT_RECORDED');
    expect((await createNetworkBridge({mode: 'off', file}).request(request)).error).toContain('NETWORK_DISABLED');
  } finally {
    server.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
