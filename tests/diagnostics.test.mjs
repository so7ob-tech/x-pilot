import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticsStatus, diagnosticsSummary } from '../src/domain/diagnostics.ts';

const check = (status) => ({ id: status, label: status, status, message: status });

test('diagnostics status prioritizes failure, warning, and not-checked results', () => {
  assert.equal(diagnosticsStatus([check('OK')]), 'OK');
  assert.equal(diagnosticsStatus([check('OK'), check('NOT_CHECKED')]), 'NOT_CHECKED');
  assert.equal(diagnosticsStatus([check('WARN'), check('NOT_CHECKED')]), 'WARN');
  assert.equal(diagnosticsStatus([check('FAIL'), check('WARN')]), 'FAIL');
});

test('diagnostics summary is derived from checks', () => {
  const result = { checks: [check('OK')] };
  assert.equal(diagnosticsSummary(result), 'Diagnostics: OK');
  assert.equal(diagnosticsSummary({ checks: [check('WARN')] }), 'Diagnostics: WARN');
});
