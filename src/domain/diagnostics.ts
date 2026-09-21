import type { DiagnosticsCheck, DiagnosticsCheckStatus, DiagnosticsResult } from './models';

export function diagnosticsStatus(checks: DiagnosticsCheck[]): DiagnosticsCheckStatus {
  if (checks.some((check) => check.status === 'FAIL')) return 'FAIL';
  if (checks.some((check) => check.status === 'WARN')) return 'WARN';
  if (checks.some((check) => check.status === 'NOT_CHECKED')) return 'NOT_CHECKED';
  return 'OK';
}

export function diagnosticsSummary(result: DiagnosticsResult): string {
  const status = diagnosticsStatus(result.checks);
  return status === 'OK' ? 'Diagnostics: OK' : status === 'WARN' ? 'Diagnostics: WARN' : status === 'FAIL' ? 'Diagnostics: FAIL' : 'Diagnostics: NOT_CHECKED';
}

export function diagnosticsSummaryKey(result: DiagnosticsResult): string {
  return `diagnostics.summary.${diagnosticsStatus(result.checks)}`;
}
