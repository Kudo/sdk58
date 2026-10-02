import {afterEach, describe, expect, it, vi} from 'vitest';

const spawnSync = vi.hoisted(() => vi.fn(() => ({status: 0, stdout: '{}', stderr: ''})));
vi.mock('node:child_process', async importOriginal => ({...await importOriginal<typeof import('node:child_process')>(), spawnSync}));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.clearAllMocks(); });
async function helpers(strict = '1') {
  vi.stubEnv('RN_A11Y_E2E_STRICT', strict);
  // An existing file suffices for resolution; these unit tests never launch it.
  vi.stubEnv('RN_A11Y_HOST_BIN', import.meta.filename);
  return import('../e2e/helpers.ts');
}

describe('strict native E2E gate', () => {
  it('fails missing hosts before tests can skip', async () => {
    vi.stubEnv('RN_A11Y_E2E_STRICT', '1');
    vi.stubEnv('RN_A11Y_HOST_BIN', '/nonexistent/a11y-host');
    await expect(import('../e2e/helpers.ts')).rejects.toThrow(/strict E2E.*host/i);
  });
  it('fails unavailable features and prerequisites instead of skipping', async () => {
    const {skipUnsupported, requireInStrictMode} = await helpers();
    const t = {skip: vi.fn((): never => { throw new Error('local skip'); })};
    expect(() => skipUnsupported(t, 'missing deviceMetrics')).toThrow(/deviceMetrics/);
    expect(t.skip).not.toHaveBeenCalled();
    expect(() => requireInStrictMode(false, 'missing expoUI.composeLayout')).toThrow(/expoUI.composeLayout/);
    expect(() => requireInStrictMode(true, 'available')).not.toThrow();
  });
  it('retains local capability skips and reduced assertions outside strict mode', async () => {
    const {skipUnsupported, requireInStrictMode} = await helpers('0');
    const t = {skip: vi.fn((): never => { throw new Error('local skip'); })};
    expect(() => skipUnsupported(t, 'missing deviceMetrics')).toThrow('local skip');
    expect(t.skip).toHaveBeenCalledWith('missing deviceMetrics');
    expect(() => requireInStrictMode(false, 'missing engine')).not.toThrow();
  });
  it('preserves explicit preset exclusions in strict mode', async () => {
    vi.stubEnv('RN_A11Y_E2E_PRESETS', 'android-phone');
    const {e2ePreset, E2E_PRESETS} = await helpers();
    expect(E2E_PRESETS.map(p => p.name)).toEqual(['android-phone']);
    const t = {skip: vi.fn(() => { throw new Error('deliberate exclusion'); })};
    expect(() => e2ePreset(t as never, 'ios-phone')).toThrow('deliberate exclusion');
    expect(t.skip).toHaveBeenCalledWith('ios-phone is not in RN_A11Y_E2E_PRESETS');
  });
  it.each(['', ' , '])('rejects an empty preset selection: %j', async value => {
    vi.stubEnv('RN_A11Y_E2E_PRESETS', value);
    await expect(helpers()).rejects.toThrow(/at least one preset/);
  });
  it('sets a bounded subprocess timeout and reports subprocess errors', async () => {
    const {cli, E2E_PRESETS} = await helpers();
    cli(['render', 'app.tsx'], E2E_PRESETS[0]);
    const options = (spawnSync.mock.calls[0] as unknown as [string, string[], {timeout: number; killSignal: string}])[2];
    expect({timeout: options.timeout, killSignal: options.killSignal}).toEqual({timeout: 120_000, killSignal: 'SIGKILL'});
    spawnSync.mockReturnValueOnce({status: null, stdout: '', stderr: '', error: new Error('ETIMEDOUT')} as never);
    expect(() => cli(['render', 'app.tsx'], E2E_PRESETS[0])).toThrow(/ETIMEDOUT/);
  });
});
