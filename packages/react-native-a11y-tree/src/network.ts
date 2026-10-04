import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type NetworkMode = 'live' | 'off' | 'record' | 'replay';
export type NetworkRequest = {url: string; method: string; headers: [string, string][]; body: string | null};
export type NetworkResponse = {status?: number; headers?: [string, string][]; body?: string; error?: string};
type Recording = {version: 1; entries: Record<string, NetworkResponse>};

export function createNetworkBridge({mode, file, signal}: {mode: NetworkMode; file: string; signal?: AbortSignal}) {
  let recording: Recording = {version: 1, entries: {}};
  if ((mode === 'record' || mode === 'replay') && fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Recording;
    if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') throw new Error(`Invalid network recording: ${file}`);
    recording = parsed;
  }
  const request = async (input: NetworkRequest): Promise<NetworkResponse> => {
    const key = createHash('sha256').update(`${input.method.toUpperCase()}\n${input.url}\n${input.body ?? ''}`).digest('hex');
    if (mode === 'off') return {error: `NETWORK_DISABLED: ${input.method} ${input.url}`};
    if (mode === 'replay') return recording.entries[key] ?? {error: `NETWORK_NOT_RECORDED: ${input.method} ${input.url}`};
    try {
      const response = await globalThis.fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body == null ? undefined : Buffer.from(input.body, 'base64'),
        signal: (signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000)) as NonNullable<Parameters<typeof globalThis.fetch>[1]>['signal'],
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 8 * 1024 * 1024) return {error: `NETWORK_RESPONSE_TOO_LARGE: ${bytes.length} bytes`};
      const result: NetworkResponse = {status: response.status, headers: [...response.headers.entries()], body: bytes.toString('base64')};
      if (mode === 'record') {
        recording.entries[key] = result;
        fs.mkdirSync(path.dirname(file), {recursive: true});
        const temp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(recording, null, 2) + '\n');
        fs.renameSync(temp, file);
      }
      return result;
    } catch (error) {
      return {error: `NETWORK_ERROR: ${error instanceof Error ? error.message : String(error)}`};
    }
  };
  return {request};
}
