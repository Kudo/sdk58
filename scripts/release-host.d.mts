export declare const HOST_PROTOCOL_VERSION: number;
export declare const NATIVE_PACKAGES: string[];
export declare function overlayHash(dir?: string): {hash: string; files: number; newestMtimeMs: number};
export declare function nativeLibVersions(): Record<string, string | null>;
