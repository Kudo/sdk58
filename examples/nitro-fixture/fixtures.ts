/**
 * Explicit JS contracts for the real packages' native entry points. No disk,
 * encryption, image decoding, drawing, native state, or hybrid refs are simulated.
 * Each host process evaluates this file afresh.
 */
const unsupported = (name: string) => () => {throw new Error(`Fixture does not implement ${name}; native behavior is not simulated.`);};
const stores = new Map<string, Map<string, string | number | boolean | ArrayBuffer>>();
let initialized = false;

export default {
  nitroModules: {
    MMKVPlatformContext: () => ({
      getBaseDirectory: () => '/explicit-fixture/mmkv',
      getAppGroupDirectory: () => undefined,
    }),
    MMKVFactory: () => ({
      defaultMMKVInstanceId: 'fixture-default-mmkv',
      initializeMMKV(root: string) {
        if (root !== '/explicit-fixture/mmkv') throw new Error('Unexpected fixture storage root');
        initialized = true;
      },
      createMMKV(config: {id: string}) {
        if (!initialized) throw new Error('MMKV fixture must be initialized first');
        let values = stores.get(config.id);
        if (!values) {values = new Map(); stores.set(config.id, values);}
        const data = values;
        return {
          id: config.id,
          set: (key: string, value: string | number | boolean | ArrayBuffer) => {data.set(key, value);},
          getString: (key: string) => {const value = data.get(key); return typeof value === 'string' ? value : undefined;},
          remove: (key: string) => data.delete(key),
          trim: unsupported('MMKV.trim'),
          checkContentChanged: unsupported('MMKV.checkContentChanged'),
        };
      },
    }),
    // The public Nitro Image entry eagerly creates these three objects. Its
    // JS wrapper asks ImageLoaderFactory for a loader, but the View fallback
    // must never decode it or invoke the platform view's hybridRef callback.
    ImageFactory: () => ({}),
    ImageLoaderFactory: () => ({
      createFileImageLoader(filePath: string) {
        if (filePath !== '/explicit-fixture/image.png') throw new Error('Unexpected fixture image path');
        return {name: 'FixtureImageLoader', dispose() {}, loadImage: unsupported('ImageLoader.loadImage')};
      },
    }),
    ImageUtils: () => ({
      supportsHeicLoading: false,
      supportsHeicWriting: false,
      thumbHashToBase64String: unsupported('ImageUtils.thumbHashToBase64String'),
      thumbhashFromBase64String: unsupported('ImageUtils.thumbhashFromBase64String'),
    }),
  },
};
