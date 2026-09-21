import type { DryRunResult, PreflightResult } from '../../domain/models';
import { DryRunCard, PreflightCard } from '../components/operation-cards';
import { useI18n } from '../../i18n';

export interface StartupTestsTabProps {
  preflight: PreflightResult | null;
  dryRun: DryRunResult | null;
  runPreflightCheck: () => void;
  runDryRunFirst: () => void;
  runDryRunQueue: () => void;
  stopDryRun: () => void;
}

export function StartupTestsTab({ preflight, dryRun, runPreflightCheck, runDryRunFirst, runDryRunQueue, stopDryRun }: StartupTestsTabProps) {
  const { t } = useI18n();
  return <section className="tab-panel" role="tabpanel" aria-label={t('tests.title')}>
    <div className="card tab-intro"><span className="eyebrow">{t('common.startupValidation')}</span><h2>{t('tests.title')}</h2><p className="muted">{t('tests.noPost')}</p></div>
    <PreflightCard result={preflight} onCheck={runPreflightCheck} />
    <DryRunCard result={dryRun} onFirst={runDryRunFirst} onQueue={runDryRunQueue} onStop={stopDryRun} />
  </section>;
}
