import {expect, it} from 'vitest';
import {installExpoModuleAdapters} from '../packages/react-native-a11y-tree/runtime/expo/moduleAdapters.ts';

function setup() {
  const warnings: string[] = [];
  const expo = {NativeModule: class {}, modules: {} as Record<string, any>};
  installExpoModuleAdapters(expo, message => warnings.push(message));
  return {expo, warnings};
}

it('loads adapters lazily, warns once, and leaves unknown modules unavailable', () => {
  const {expo, warnings} = setup();
  expect(warnings).toEqual([]);
  expect(expo.modules.ExpoImage).toBe(expo.modules.ExpoImage);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('[NATIVE_MODULE_FALLBACK] ExpoImage');
  expect(expo.modules.Unknown).toBeUndefined();
  expect(expo.modules.ExpoSplashScreen).toBeUndefined();
});

it('does not replace an existing native module', () => {
  const original = {};
  const expo = {NativeModule: class {}, modules: {ExpoImage: original}};
  installExpoModuleAdapters(expo, () => {throw new Error('unexpected warning');});
  expect(expo.modules.ExpoImage).toBe(original);
});

it('image APIs reject unsupported native operations rather than reporting success', async () => {
  const {expo} = setup();
  await expect(expo.modules.ExpoImage.loadAsync('image.png')).rejects.toThrow('ExpoImage.loadAsync');
  await expect(expo.modules.ExpoImage.prefetch(['https://example.com/image.png'])).rejects.toThrow('not simulated');
  expect(() => new expo.modules.ExpoImage.Image()).toThrow('not simulated');
});

it('device/linking/font adapters expose only the documented headless behavior', async () => {
  const {expo} = setup();
  expect(expo.modules.ExpoDevice.isDevice).toBe(false);
  expect(expo.modules.ExpoDevice.modelName).toBe(null);
  expect(expo.modules.ExpoDevice.deviceType).toBe(null);
  expect(expo.modules.ExpoLinking.getLinkingURL()).toBe(null);
  expect(expo.modules.ExpoFontLoader.getLoadedFonts()).toEqual([]);
  await expect(expo.modules.ExpoFontLoader.loadAsync('Font', 'font.ttf')).rejects.toThrow('not simulated');
  await expect(expo.modules.ExpoWebBrowser.openBrowserAsync('https://example.com')).rejects.toThrow('not simulated');
});

it('reports unsupported API calls even when the app catches the rejection, once per API', async () => {
  const {expo, warnings} = setup();
  await expo.modules.ExpoImage.loadAsync('one').catch(() => {});
  await expo.modules.ExpoImage.loadAsync('two').catch(() => {});
  expect(warnings.filter(message => message.startsWith('[NATIVE_API_UNSUPPORTED]'))).toEqual([
    expect.stringContaining('ExpoImage.loadAsync'),
  ]);
});
