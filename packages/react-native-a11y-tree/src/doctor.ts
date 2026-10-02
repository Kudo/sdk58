import {inspectCompatibility, type CompatibilityReport} from './compatibility.ts';
import {CliError, type ErrorInfo} from './errors.ts';
import {checkProtocol, defaultProbes, findHost, type HostInfo} from './host.ts';

export type DoctorResult = CompatibilityReport & {
  strict: boolean;
  /** File/metadata discovery only: doctor never executes or downloads a host. */
  host: {found: true; info: HostInfo} | {found: false; error: ErrorInfo};
};

export async function inspectDoctor(projectRoot: string, strict = false): Promise<DoctorResult> {
  let host: DoctorResult['host'];
  try {
    const probes = defaultProbes(() => {}, true);
    const info = await findHost(probes);
    checkProtocol(info);
    host = {found: true, info};
  } catch (error) {
    host = {found: false, error: error instanceof CliError ? error.toJSON() : {code: 'HOST_UNAVAILABLE', message: String(error)}};
  }
  const report = inspectCompatibility(projectRoot, host.found ? host.info : {});
  return {...report, ok: host.found && report.ok && (!strict || report.tested), strict, host};
}
