/**
 * What the host supports: the optional NativeFantom methods that exist, plus
 * whatever the host reports through NativeFantom.getCapabilities() (for
 * features without a method of their own, e.g. `getA11yTree.mounted`).
 */

const NativeFantom = (require('./fantom/specs/NativeFantom') as typeof import('./fantom/specs/NativeFantom'))
  .default;

const OPTIONAL_METHODS: Array<keyof typeof NativeFantom> = [
  'getA11yTree',
  'hitTest',
  'enqueueNativeEventByTag',
  'enqueueScrollEventByTag',
  'setTextInputTextByTag',
  'updateNativeStates',
  'setScreensHeaderHeight',
  'setSafeAreaInsets',
];

export function getCapabilities(): string[] {
  const out: string[] = OPTIONAL_METHODS.filter(name => typeof NativeFantom[name] === 'function');
  if (typeof NativeFantom.getCapabilities === 'function') {
    // The host returns a JSON array (string); accept an array too.
    const raw = NativeFantom.getCapabilities();
    const reported: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    for (const name of Array.isArray(reported) ? reported : []) {
      if (!out.includes(name)) out.push(name);
    }
  }
  return out;
}

/**
 * The host's build info: `NativeFantom.getHostInfo()` (JSON:
 * {protocolVersion, rnVersion, buildType, sanitize, engines, fonts}), else
 * `{protocolVersion}` from a `protocolVersion:<n>` capability, else null
 * (hosts older than the protocol check). The CLI checks protocolVersion.
 */
/** `NativeFantom.getHostInfo()` JSON (HostRuntimeInfo in src/schema.ts). */
export type HostInfo = {protocolVersion?: number; [key: string]: unknown};

export function getHostInfo(): HostInfo | null {
  if (typeof NativeFantom.getHostInfo === 'function') {
    const raw = NativeFantom.getHostInfo();
    return typeof raw === 'string' ? (JSON.parse(raw) as HostInfo) : raw;
  }
  for (const name of getCapabilities()) {
    const m = /^protocolVersion:(\d+)$/.exec(name);
    if (m) return {protocolVersion: Number(m[1])};
  }
  return null;
}
