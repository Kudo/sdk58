export declare class HostUnavailableError extends Error {
  readonly code: 'HOST_UNAVAILABLE';
  readonly platform: string;
  readonly arch: string;
  constructor(platform: string, arch: string);
}
export declare function hostRelativePath(platform?: string, arch?: string): string;
export declare function getHostPath(platform?: string, arch?: string): string;
export declare function getHostVersionPath(): string;
