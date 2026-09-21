import type { DryRunResult, PreflightResult } from '../../domain/models';
import { DryRunCard, PreflightCard } from '../components/operation-cards';

export interface StartupTestsTabProps {
  preflight: PreflightResult | null;
  dryRun: DryRunResult | null;
  runPreflightCheck: () => void;
  runDryRunFirst: () => void;
  runDryRunQueue: () => void;
  stopDryRun: () => void;
}

export function StartupTestsTab({ preflight, dryRun, runPreflightCheck, runDryRunFirst, runDryRunQueue, stopDryRun }: StartupTestsTabProps) {
  return <section className="tab-panel" role="tabpanel" aria-label="اختبارات البدء">
    <div className="card tab-intro"><span className="eyebrow">STARTUP VALIDATION</span><h2>اختبارات البدء</h2><p className="muted">تحقق من جاهزية X وQueue والصلاحيات قبل تشغيل النشر. اختبار Dry Run يفتح العناصر ويفحص Composer وزر Post دون الضغط عليه أو زيادة المحاولات.</p></div>
    <PreflightCard result={preflight} onCheck={runPreflightCheck} />
    <DryRunCard result={dryRun} onFirst={runDryRunFirst} onQueue={runDryRunQueue} onStop={stopDryRun} />
  </section>;
}
