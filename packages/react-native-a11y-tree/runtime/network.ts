/** Web API subset backed by the CLI process. Installed before the app imports. */

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encode64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const value = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += alphabet[(value >>> 18) & 63] + alphabet[(value >>> 12) & 63]
      + (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=')
      + (i + 2 < bytes.length ? alphabet[value & 63] : '=');
  }
  return out;
}

function decode64(value: string): Uint8Array {
  const clean = value.replace(/[^A-Za-z0-9+/]/g, '');
  const result = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let bits = 0;
  let count = 0;
  let offset = 0;
  for (const char of clean) {
    bits = (bits << 6) | alphabet.indexOf(char);
    count += 6;
    if (count >= 8) {
      count -= 8;
      result[offset++] = (bits >>> count) & 255;
    }
  }
  return result.slice(0, offset);
}

function utf8(value: string): Uint8Array {
  const Encoder = (globalThis as any).TextEncoder;
  if (Encoder) return new Encoder().encode(value);
  const escaped = unescape(encodeURIComponent(value));
  return Uint8Array.from(escaped, c => c.charCodeAt(0));
}

function text(bytes: Uint8Array): string {
  const Decoder = (globalThis as any).TextDecoder;
  if (Decoder) return new Decoder().decode(bytes);
  let encoded = '';
  for (const byte of bytes) encoded += `%${byte.toString(16).padStart(2, '0')}`;
  return decodeURIComponent(encoded);
}

export class BridgeHeaders {
  private readonly map = new Map<string, string>();
  constructor(init?: BridgeHeaders | Record<string, string> | [string, string][]) {
    if (init instanceof BridgeHeaders) for (const [key, value] of init) this.set(key, value);
    else if (Array.isArray(init)) for (const [key, value] of init) this.set(key, value);
    else if (init) for (const [key, value] of Object.entries(init)) this.set(key, value);
  }
  set(key: string, value: string) { this.map.set(key.toLowerCase(), String(value)); }
  append(key: string, value: string) { this.set(key, this.has(key) ? `${this.get(key)}, ${value}` : value); }
  get(key: string): string | null { return this.map.get(key.toLowerCase()) ?? null; }
  has(key: string): boolean { return this.map.has(key.toLowerCase()); }
  delete(key: string) { this.map.delete(key.toLowerCase()); }
  entries() { return this.map.entries(); }
  keys() { return this.map.keys(); }
  values() { return this.map.values(); }
  forEach(callback: (value: string, key: string) => void) { this.map.forEach(callback); }
  [Symbol.iterator]() { return this.entries(); }
}

type Init = {method?: string; headers?: BridgeHeaders | Record<string, string> | [string, string][]; body?: string | Uint8Array | null; signal?: AbortSignal};

export class BridgeRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: BridgeHeaders;
  readonly body: string | Uint8Array | null;
  readonly signal?: AbortSignal;
  constructor(input: string | BridgeRequest | {toString(): string}, init: Init = {}) {
    const previous = input instanceof BridgeRequest ? input : null;
    this.url = previous?.url ?? String(input);
    this.method = (init.method ?? previous?.method ?? 'GET').toUpperCase();
    this.headers = new BridgeHeaders(init.headers ?? previous?.headers);
    this.body = init.body === undefined ? (previous?.body ?? null) : init.body;
    this.signal = init.signal ?? previous?.signal;
  }
  clone() { return new BridgeRequest(this); }
}

export class BridgeResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: BridgeHeaders;
  readonly bodyUsed = false;
  private readonly bytes: Uint8Array;
  constructor(body: string | Uint8Array | null = null, init: {status?: number; headers?: BridgeHeaders | Record<string, string> | [string, string][]} = {}) {
    this.bytes = body == null ? new Uint8Array() : typeof body === 'string' ? utf8(body) : body;
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new BridgeHeaders(init.headers);
  }
  async text() { return text(this.bytes); }
  async json() { return JSON.parse(await this.text()); }
  async arrayBuffer() { return this.bytes.slice().buffer; }
  clone() { return new BridgeResponse(this.bytes.slice(), {status: this.status, headers: this.headers}); }
}

export async function bridgeFetch(input: string | BridgeRequest, init: Init = {}): Promise<BridgeResponse> {
  const request = new BridgeRequest(input, init);
  if (request.signal?.aborted) throw new Error('AbortError: request aborted');
  const send = (globalThis as any).__rnA11yNetworkRequest as ((json: string) => string | Promise<string>) | undefined;
  if (!send) throw new Error('NETWORK_BRIDGE_UNAVAILABLE: use a one-shot render/run or check on a simulator');
  const body = request.body == null ? null : encode64(typeof request.body === 'string' ? utf8(request.body) : request.body);
  const sent = send(JSON.stringify({url: request.url, method: request.method, headers: [...request.headers], body}));
  const raw = typeof sent === 'string' ? sent : await sent;
  const result = JSON.parse(raw) as {status?: number; headers?: [string, string][]; body?: string; error?: string};
  if (result.error) throw new Error(result.error);
  if (request.signal?.aborted) throw new Error('AbortError: request aborted');
  return new BridgeResponse(decode64(result.body ?? ''), {status: result.status, headers: result.headers});
}

class BridgeXMLHttpRequest {
  readyState = 0;
  status = 0;
  responseText = '';
  response: unknown = null;
  responseType = '';
  onreadystatechange: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: ((error?: unknown) => void) | null = null;
  private method = 'GET';
  private url = '';
  private headers = new BridgeHeaders();
  open(method: string, url: string) { this.method = method; this.url = url; this.readyState = 1; this.onreadystatechange?.(); }
  setRequestHeader(key: string, value: string) { this.headers.set(key, value); }
  send(body?: string) {
    void bridgeFetch(this.url, {method: this.method, headers: this.headers, body}).then(async response => {
      this.status = response.status;
      this.responseText = await response.text();
      this.response = this.responseType === 'json' ? JSON.parse(this.responseText) : this.responseText;
      this.readyState = 4;
      this.onreadystatechange?.();
      this.onload?.();
    }).catch(error => { this.readyState = 4; this.onreadystatechange?.(); this.onerror?.(error); });
  }
  abort() { this.readyState = 0; }
}

const pendingRequests = new Map<number, (response: string) => void>();
let nextRequestId = 0;

export function completeNetworkRequest(requestId: number, response: unknown) {
  const resolve = pendingRequests.get(requestId);
  pendingRequests.delete(requestId);
  resolve?.(JSON.stringify(response));
}

export function installNetwork(session = false) {
  if (session) {
    (globalThis as any).__rnA11yNetworkRequest = (json: string) => new Promise<string>(resolve => {
      const requestId = nextRequestId++;
      pendingRequests.set(requestId, resolve);
      const NativeFantom = (require('./fantom/specs/NativeFantom') as typeof import('./fantom/specs/NativeFantom')).default;
      NativeFantom.reportTestSuiteResultsJSON(JSON.stringify({
        type: 'rn-a11y-tree-fetch', requestId, request: JSON.parse(json),
      }));
    });
  }
  (globalThis as any).Headers = BridgeHeaders;
  (globalThis as any).Request = BridgeRequest;
  (globalThis as any).Response = BridgeResponse;
  (globalThis as any).fetch = bridgeFetch;
  (globalThis as any).XMLHttpRequest = BridgeXMLHttpRequest;
}
