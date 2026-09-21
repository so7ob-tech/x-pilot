import type { ReactNode } from 'react';
import type { DryRunResult, PreflightResult, QueueItem } from '../../domain/models';
import { getTweetPreview } from '../../extraction/tweet-preview';
import { getUserFacingMessage } from '../services/error-messages';
import { useI18n } from '../../i18n';

export function CurrentTweetCard({ item, position, logoUrl }: { item?: QueueItem; position?: number; logoUrl: string }) {
  const { t } = useI18n();
  return <section className="card current-card"><div className="current-heading"><div className="current-brand"><img src={logoUrl} alt="" /><div><span className="eyebrow">{t('operation.currentTweet')}</span><h2>{t('operation.currentTweet')}</h2></div></div>{item && <span className={`item-status status-${item.status}`}>{t(`statuses.${item.status}`)}</span>}</div>{item ? <><p className="current-preview" dir="auto">{getTweetPreview(item.targetUrl, item.label, 180)}</p><div className="current-meta"><span>{t('ui.currentItem')} {position ?? item.position}</span><span>المحاولات {item.attempts}</span>{item.startedAt && <span>بدأت {new Date(item.startedAt).toLocaleTimeString('ar')}</span>}</div>{item.lastError && <p className="error-text">آخر خطأ: {getUserFacingMessage(item.lastError)}</p>}<a className="primary-link" href={item.targetUrl} target="_blank" rel="noreferrer">فتح رابط التغريدة</a></> : <p className="muted">لا توجد تغريدة قيد التشغيل حاليًا. {t('common.queue')} من تبويب {t('nav.operation')}.</p>}</section>;
}

export function RecoveryCard({ logoUrl, onResume }: { logoUrl: string; onResume: () => void }) {
  const { t } = useI18n();
  return <section className="card recovery-card"><div className="current-brand"><img src={logoUrl} alt="" /><div><span className="eyebrow">X-PILOT</span><h2>استعادة {t('common.queue')}</h2></div></div><p className="muted">توجد عناصر غير مكتملة من جلسة سابقة. يمكنك استئناف النشر من العنصر الحالي.</p><button className="primary" onClick={onResume}>{t('actions.resume')} {t('common.queue')}</button></section>;
}

export function PreflightCard({ result, onCheck }: { result: PreflightResult | null; onCheck: () => void }) {
  const { t } = useI18n();
  return <section className={`card preflight-card ${result ? (result.ready ? 'preflight-ready' : 'preflight-blocked') : ''}`}><div className="section-heading"><div><span className="eyebrow">{t('tests.preflight')}</span><h2>{t('tests.validation')}</h2></div><button className="primary" onClick={onCheck}>{t('tests.runPreflight')}</button></div>{result ? <><div className="preflight-summary"><strong>{result.summary}</strong><span>{result.counts.ready} جاهز · {result.counts.published} منشور · {result.counts.duplicates + result.counts.publishedDuplicates} مكرر · {result.counts.invalid} غير صالح</span></div><div className="preflight-checks">{result.checks.map((check) => <div className={`preflight-check preflight-${check.status.toLowerCase()}`} key={check.id}><span className="preflight-icon" aria-hidden="true">{check.status === 'PASS' ? '✓' : check.status === 'WARN' ? '!' : '×'}</span><div><strong>{check.message}</strong>{check.details && <small>{getUserFacingMessage(check.details)}</small>}</div></div>)}</div><small className="muted">تم فحص X تلقائيًا عبر تبويب X مؤقت أو تبويب الأتمتة · آخر فحص: {new Date(result.checkedAt).toLocaleTimeString('ar')}</small></> : <p className="muted">اضغط فحص الآن؛ سيقوم X-Pilot بفتح تبويب X تلقائيًا والتحقق من تسجيل الدخول والمحرر والمحتوى وزر النشر.</p>}</section>;
}

function getDryRunPreview(targetUrl: string): string {
  const text = getTweetPreview(targetUrl, undefined, 1000).trim();
  return text.split(/\s+/u).slice(0, 10).join(' ') || 'منشور X جاهز للنشر';
}

export function DryRunCard({ result, onFirst, onQueue, onStop }: { result: DryRunResult | null; onFirst: () => void; onQueue: () => void; onStop: () => void }) {
  const { t } = useI18n();
  return <section className="card"><div className="section-heading"><div><span className="eyebrow">{t('tests.dryRun')}</span><h2>اختبار {t('common.queue')} دون نشر</h2></div>{result && <span className={`item-status status-${result.status}`}>{t(`statuses.${result.status}`)}</span>}</div><p className="muted">يفتح صفحة X ويفحص المحرر والمحتوى وزر النشر دون الضغط عليه أو زيادة المحاولات.</p><div className="row controls-row"><button onClick={onFirst} disabled={result?.status === 'RUNNING'}>{t('tests.testFirst')}</button><button className="primary" onClick={onQueue} disabled={result?.status === 'RUNNING'}>{t('tests.testQueue')}</button><button className="danger" onClick={onStop} disabled={result?.status !== 'RUNNING'}>{t('tests.stopTest')}</button></div>{result && <><div className="stats"><div><b>{result.checked}</b><span>تم فحصه</span></div><div><b>{result.ready}</b><span>جاهز</span></div><div><b>{result.failed}</b><span>فشل</span></div><div><b>{result.total}</b><span>الإجمالي</span></div></div>{result.status === 'FAILED' && result.error && <div className="runtime-warning" role="alert">تعذر بدء الاختبار: <b dir="auto">{getUserFacingMessage(result.error)}</b></div>}<div className="queue">{result.items.map((item) => <div className="queue-row" key={item.queueItemId}><strong>العنصر #{item.position}</strong><span className={`item-status status-${item.status}`}>{t(`statuses.${item.status}`)}</span><span className="dry-run-preview" dir="auto">{getDryRunPreview(item.targetUrl)}</span>{item.reason && <small>{getUserFacingMessage(item.reason)}</small>}</div>)}</div></>}</section>;
}
