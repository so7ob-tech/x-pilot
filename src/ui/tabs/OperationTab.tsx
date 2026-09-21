import type { Dispatch, SetStateAction } from 'react';
import type { AppState, PreflightResult, QueueItem, RuntimeMessage, Settings } from '../../domain/models';
import { MetricCard, ProgressBar } from '../components';
import { CurrentTweetCard, RecoveryCard } from '../components/operation-cards';

export interface OperationTabProps {
  state: AppState;
  session: AppState['session'];
  currentItem?: QueueItem;
  logoUrl: string;
  activeWorkspaceName?: string;
  published: number;
  failed: number;
  remaining: number;
  progress: number;
  countdownSeconds: number;
  canPause: boolean;
  canResume: boolean;
  preflight: PreflightResult | null;
  settings: Settings;
  scheduleAt: string;
  setScheduleAt: Dispatch<SetStateAction<string>>;
  start: () => void;
  stop: () => void;
  schedule: (reschedule?: boolean) => void;
  act: (message: RuntimeMessage, success?: string) => void;
}

export function OperationTab({ state, session, currentItem, logoUrl, activeWorkspaceName, published, failed, remaining, progress, countdownSeconds, canPause, canResume, preflight, settings, scheduleAt, setScheduleAt, start, stop, schedule, act }: OperationTabProps) {
  return <section className="tab-panel" role="tabpanel" aria-label="التشغيل">
    <section className="card operation-hero"><div className="hero-copy"><span className="eyebrow">PUBLISHING CONTROL CENTER</span><h2>لوحة التشغيل</h2><p>{activeWorkspaceName ?? 'Workspace الحالية'} · {session?.status === 'RUNNING' ? 'المحرك يعمل الآن' : 'جاهز للتشغيل'}</p></div><div className="hero-metric"><strong>{published}<small>/{state.queue.length}</small></strong><span>منشور</span></div><ProgressBar value={progress} label="نسبة النشر" /><div className="stats compact-stats"><MetricCard label="متبقٍ" value={remaining} tone="primary" /><MetricCard label="فشل" value={failed} tone={failed ? 'danger' : 'neutral'} /><MetricCard label="تم التخطي" value={state.queue.filter((item) => item.status === 'SKIPPED').length} /></div>{session?.status === 'SCHEDULED' && session.scheduledStartAt && <div className="countdown dashboard-countdown"><span>تبدأ الجلسة في</span><strong>{new Date(session.scheduledStartAt).toLocaleString('ar')}</strong></div>}{session?.status === 'WAITING' && <div className="countdown dashboard-countdown"><span>التغريدة التالية بعد</span><strong>{formatCountdown(countdownSeconds)}</strong></div>}</section>
    <CurrentTweetCard item={currentItem} position={session?.currentIndex} logoUrl={logoUrl} />
    {session?.status === 'PAUSED' && remaining > 0 && <RecoveryCard logoUrl={logoUrl} onResume={() => void act({ type: 'RESUME' }, 'تم استئناف Queue')} />}
    <section className="card controls"><h2>التشغيل</h2><div className="row controls-row"><button className="primary" onClick={start} disabled={!state.queue.length || canPause || canResume || session?.status === 'SCHEDULED' || preflight === null || !preflight.ready}>Start</button><button onClick={() => void act({ type: 'PAUSE' }, 'تم إيقاف Queue مؤقتًا')} disabled={!canPause}>Pause</button><button onClick={() => void act({ type: 'RESUME' }, 'تم استئناف Queue')} disabled={!canResume}>Resume</button><button className="danger" onClick={stop} disabled={!session || session.status === 'STOPPED' || session.status === 'COMPLETED'}>{session?.status === 'SCHEDULED' ? 'Cancel Schedule' : 'Stop'}</button></div><div className="schedule-controls"><label>Start At<input type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /></label><div className="row controls-row"><button onClick={() => schedule(false)} disabled={!state.queue.length || !scheduleAt || canPause || canResume}>Schedule</button><button onClick={() => schedule(true)} disabled={session?.status !== 'SCHEDULED' || !scheduleAt}>Reschedule</button></div></div><p className="muted">العنصر الحالي: {session?.currentItemId ? currentItem?.position ?? '-' : '-'}</p>{session?.status === 'PAUSED' && <p className="paused-hint">Queue متوقف مؤقتًا — اضغط Resume للمتابعة.</p>}</section>
  </section>;
}

function formatCountdown(totalSeconds: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
