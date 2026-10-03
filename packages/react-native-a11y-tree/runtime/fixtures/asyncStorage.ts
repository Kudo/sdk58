/** Opt-in, per-host AsyncStorage fixture. Nothing is persisted across invocations. */
const values = new Map<string, string>();
console.warn('[NATIVE_MODULE_FALLBACK] RNCAsyncStorage: in-memory fixture; persistence and native behavior are not simulated.');

export async function getItem(key: string): Promise<string | null> { return values.get(key) ?? null; }
export async function setItem(key: string, value: string): Promise<void> { values.set(key, String(value)); }
export async function removeItem(key: string): Promise<void> { values.delete(key); }
export async function clear(): Promise<void> { values.clear(); }
export async function getAllKeys(): Promise<string[]> { return [...values.keys()]; }
export async function multiGet(keys: string[]): Promise<Array<[string, string | null]>> {
  return keys.map(key => [key, values.get(key) ?? null]);
}
export async function multiSet(entries: Array<[string, string]>): Promise<void> {
  for (const [key, value] of entries) values.set(key, String(value));
}
export async function multiRemove(keys: string[]): Promise<void> {
  for (const key of keys) values.delete(key);
}

export default {getItem, setItem, removeItem, clear, getAllKeys, multiGet, multiSet, multiRemove};
