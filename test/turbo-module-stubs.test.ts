import {afterEach, expect, it, vi} from 'vitest';

afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules();});

it('rejects unsupported Linking operations and reports each API even when errors are caught', async () => {
  vi.stubGlobal('__turboModuleProxy', () => null);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const {installTurboModuleStubs} = await import('../packages/react-native-a11y-tree/runtime/turboModuleStubs.ts');
  installTurboModuleStubs();
  const linking = (global as any).__turboModuleProxy('LinkingManager');
  expect(await linking.getInitialURL()).toBeNull();
  for (const method of ['openURL', 'openSettings', 'canOpenURL']) {
    for (let i = 0; i < 2; i++) {
      await expect(linking[method]('https://example.invalid')).rejects.toThrow(`[NATIVE_API_UNSUPPORTED] LinkingManager.${method}`);
    }
    expect(warn.mock.calls.filter(([message]) => String(message).startsWith(`[NATIVE_API_UNSUPPORTED] LinkingManager.${method}`))).toHaveLength(1);
  }
});

it('preserves native modules and explicit application Linking fixtures', async () => {
  const native = {openURL: vi.fn()};
  vi.stubGlobal('__turboModuleProxy', () => native);
  const {installTurboModuleStubs, registerTurboModuleFixture} = await import('../packages/react-native-a11y-tree/runtime/turboModuleStubs.ts');
  installTurboModuleStubs();
  expect((global as any).__turboModuleProxy('LinkingManager')).toBe(native);
  const fixture = {openURL: vi.fn()};
  registerTurboModuleFixture('LinkingManager', () => fixture);
  expect((global as any).__turboModuleProxy('LinkingManager')).toBe(fixture);
});
