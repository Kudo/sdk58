// Explicit in-memory contract for AsyncStorage 2.2.0. This does not test disk IO,
// encryption, native lifecycle, merge operations, quotas, or cross-process persistence.
const values = new Map<string, string>();
type Callback = (errors: null | Array<{message: string}>) => void;

export default {
  turboModules: {
    RNCAsyncStorage: {
      multiGet(keys: string[], callback: (errors: null, result: Array<[string, string | null]>) => void) {
        callback(null, keys.map(key => [key, values.get(key) ?? null]));
      },
      multiSet(entries: Array<[string, string]>, callback: Callback) {
        for (const [key, value] of entries) values.set(key, value);
        callback(null);
      },
      multiRemove(keys: string[], callback: Callback) {
        for (const key of keys) values.delete(key);
        callback(null);
      },
    },
  },
};
