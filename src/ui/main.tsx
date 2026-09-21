import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppMetaState, AppState, QueueItem, RuntimeMessage, RuntimeStatus, Settings, Workspace } from '../domain/models';
import { defaultSettings } from '../domain/models';
import { getTweetPreview } from '../extraction/tweet-preview';
import './styles.css';

const initialState: AppState = { queue: [], session: null, history: [] };
const initialRuntimeStatus: RuntimeStatus = { engineStatus: 'IDLE', connection: 'NOT_REQUIRED', checkedAt: 0 };
type TabId = 'operation' | 'queue' | 'workspaces' | 'settings';

function send(message: RuntimeMessage): Promise<any> { return chrome.runtime.sendMessage(message); }

function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [bankUrl, setBankUrl] = useState('');
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [notice, setNotice] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());
  const [activeTab, setActiveTab] = useState<TabId>('operation');
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(initialRuntimeStatus);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [meta, setMeta] = useState<AppMetaState | null>(null);
  const session = state.session;
  const published = useMemo(() => state.queue.filter((item) => item.status === 'PUBLISHED' || item.status === 'PUBLISHED_UNVERIFIED').length, [state.queue]);
  const failed = useMemo(() => state.queue.filter((item) => item.status === 'FAILED').length, [state.queue]);
  const remaining = state.queue.length - published - failed;
  const currentItem = session?.currentItemId ? state.queue.find((item) => item.id === session.currentItemId) : undefined;
  const countdownSeconds = session?.status === 'WAITING' && session.nextRunAt ? Math.max(0, Math.ceil((session.nextRunAt - nowMs) / 1000)) : 0;
  const canPause = session?.status === 'RUNNING' || session?.status === 'WAITING';
  const canResume = session?.status === 'PAUSED';
  const logoUrl = chrome.runtime.getURL('branding/x-pilot-logo.png');
  const activeWorkspace = workspaces.find((workspace) => workspace.id === meta?.activeWorkspaceId);
  const runningWorkspace = workspaces.find((workspace) => workspace.id === runtimeStatus.automationWorkspaceId);

  const refresh = async () => { const next = await send({ type: 'GET_STATE' }); if (next && !next.error) setState(next); };
  const refreshWorkspaces = async () => { const next = await send({ type: 'GET_WORKSPACES' }); if (next?.workspaces) { setWorkspaces(next.workspaces); setMeta(next.meta); } };
  const refreshRuntimeStatus = async () => { const next = await send({ type: 'GET_RUNTIME_STATUS' }); if (next && !next.error) setRuntimeStatus(next); };
  useEffect(() => { void refresh(); void refreshWorkspaces(); void refreshRuntimeStatus(); const listener = (message: any) => { if (message.type === 'STATE_UPDATED') { setState(message.state); void refreshWorkspaces(); void refreshRuntimeStatus(); } }; chrome.runtime.onMessage.addListener(listener); return () => chrome.runtime.onMessage.removeListener(listener); }, []);
  useEffect(() => { const timer = window.setInterval(() => void refreshRuntimeStatus(), 1500); return () => window.clearInterval(timer); }, []);
  useEffect(() => { const timer = window.setInterval(() => setNowMs(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const act = async (message: RuntimeMessage, success?: string) => { const result = await send(message); if (result?.error) setNotice(result.error); else { if (result?.queue) setState(result); else await refresh(); if (success) setNotice(success); } };
  const extract = async () => {
    if (!bankUrl.trim()) return setNotice('أدخل رابط بنك التغريدات أولًا');
    let parsed: URL;
    try { parsed = new URL(bankUrl.trim()); } catch { return setNotice('رابط البنك غير صالح'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return setNotice('يجب أن يبدأ رابط البنك بـ http أو https');
    const originPattern = `${parsed.protocol}//${parsed.host}/*`;
    const granted = await chrome.permissions.request({ origins: [originPattern] });
    if (!granted) return setNotice('لم يتم منح صلاحية قراءة نطاق بنك التغريدات');
    const result = await send({ type: 'EXTRACT_BANK', bankUrl: bankUrl.trim(), workspaceId: meta?.activeWorkspaceId });
    if (result?.error) return setNotice(`فشل الاستخراج: ${result.error}`);
    if (result?.queue) setState(result);
    setNotice(`تم العثور على ${result?.queue?.length ?? 0} رابطًا`);
  };
  const start = async () => { if (settings.confirmBeforeStart && !window.confirm(`بدء نشر ${remaining} عنصر؟`)) return; await act({ type: 'START', confirmed: true, workspaceId: meta?.activeWorkspaceId }, 'بدأت الجلسة'); };
  const updateSettings = async (next: Settings) => { setSettings(next); await act({ type: 'UPDATE_SETTINGS', settings: next }); };
  const switchWorkspace = async (workspaceId: string) => { const result = await send({ type: 'SET_ACTIVE_WORKSPACE', workspaceId }); if (result?.error) return setNotice(result.error); await refreshWorkspaces(); await refresh(); setActiveTab('operation'); };
  const createNewWorkspace = async () => { const name = window.prompt('اسم Workspace الجديدة؟'); if (!name?.trim()) return; const result = await send({ type: 'CREATE_WORKSPACE', name: name.trim() }); if (result?.error) return setNotice(result.error); await refreshWorkspaces(); };
  const archive = async (workspaceId: string) => { const result = await send({ type: 'ARCHIVE_WORKSPACE', workspaceId }); if (result?.error) return setNotice(result.error); await refreshWorkspaces(); await refresh(); };
  const remove = async (workspace: Workspace) => { if (!window.confirm(`سيتم حذف Workspace "${workspace.name}" وبياناتها المحلية. هل تريد المتابعة؟`)) return; const result = await send({ type: 'DELETE_WORKSPACE', workspaceId: workspace.id, confirmed: true }); if (result?.error) return setNotice(result.error); await refreshWorkspaces(); await refresh(); };

  return <main className="shell">
    <header className="brand-header"><div className="brand-lockup"><img className="brand-logo" src={logoUrl} alt="X-Pilot" /><div><span className="eyebrow">LOCAL-FIRST · MV3</span><h1>قائمة نشر X</h1></div></div><span className={`status status-${session?.status ?? 'IDLE'}`}>{session?.status ?? 'IDLE'}</span></header>
    <div className="workspace-switcher"><span className="eyebrow">WORKSPACE</span><select value={meta?.activeWorkspaceId ?? ''} onChange={(event) => void switchWorkspace(event.target.value)} aria-label="Workspace النشطة">{workspaces.filter((workspace) => !workspace.archived).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.favorite ? '★ ' : ''}{workspace.name}</option>)}</select><button onClick={() => setActiveTab('workspaces')}>إدارة المساحات</button></div>
    <nav className="tabs-bar" aria-label="حالة X-Pilot والتبويبات"><div className="tabs" role="tablist">
      <TabButton id="operation" activeTab={activeTab} onSelect={setActiveTab} icon="▶" label="التشغيل" />
      <TabButton id="queue" activeTab={activeTab} onSelect={setActiveTab} icon="☷" label="بنك التغريدات" />
      <TabButton id="workspaces" activeTab={activeTab} onSelect={setActiveTab} icon="▦" label="مساحات العمل" />
      <TabButton id="settings" activeTab={activeTab} onSelect={setActiveTab} icon="⚙" label="الإعدادات" />
    </div><div className="runtime-indicators" aria-live="polite"><StatusIndicator kind="connection" value={runtimeStatus.connection} label={connectionLabel(runtimeStatus.connection)} /><StatusIndicator kind="engine" value={runtimeStatus.engineStatus} label={engineLabel(runtimeStatus.engineStatus)} /></div></nav>
    {runtimeStatus.connection === 'DISCONNECTED' && <div className="runtime-warning" role="status">تبويب الأتمتة غير متصل — قد يتعذر تنفيذ التغريدة الحالية.</div>}
    {runningWorkspace && runningWorkspace.id !== meta?.activeWorkspaceId && <button className="running-workspace" onClick={() => void switchWorkspace(runningWorkspace.id)}>● يعمل الآن: {runningWorkspace.name} — فتح Workspace الجارية</button>}
    {notice && <div className="notice">{notice}</div>}

    {activeTab === 'operation' && <section className="tab-panel" role="tabpanel" aria-label="التشغيل">
      <section className="card"><div className="section-heading"><h2>لوحة التشغيل</h2><span className="session-progress">{published} منشور · {remaining} متبقٍ</span></div><div className="stats"><div><b>{state.queue.length}</b><span>الإجمالي</span></div><div><b>{published}</b><span>منشور</span></div><div><b>{failed}</b><span>فشل</span></div><div><b>{remaining}</b><span>متبقٍ</span></div></div></section>
      <CurrentTweetCard item={currentItem} position={session?.currentIndex} logoUrl={logoUrl} />
      {session?.status === 'PAUSED' && remaining > 0 && <RecoveryCard logoUrl={logoUrl} onResume={() => void act({ type: 'RESUME' }, 'تم استئناف Queue')} />}
      <section className="card controls"><h2>التشغيل</h2><div className="row controls-row"><button className="primary" onClick={start} disabled={!state.queue.length || canPause || canResume}>Start</button><button onClick={() => void act({ type: 'PAUSE' }, 'تم إيقاف Queue مؤقتًا')} disabled={!canPause}>Pause</button><button onClick={() => void act({ type: 'RESUME' }, 'تم استئناف Queue')} disabled={!canResume}>Resume</button><button className="danger" onClick={() => void act({ type: 'STOP' }, 'تم إيقاف Queue نهائيًا')} disabled={!session || session.status === 'STOPPED' || session.status === 'COMPLETED'}>Stop</button></div><p className="muted">العنصر الحالي: {session?.currentItemId ? currentItem?.position ?? '-' : '-'}</p>{session?.status === 'PAUSED' && <p className="paused-hint">Queue متوقف مؤقتًا — اضغط Resume للمتابعة.</p>}{session?.status === 'WAITING' && <div className="countdown"><span>التغريدة التالية بعد</span><strong>{formatCountdown(countdownSeconds)}</strong></div>}</section>
    </section>}

    {activeTab === 'queue' && <section className="tab-panel" role="tabpanel" aria-label="بنك التغريدات وقائمة Queue">
      <section className="card"><h2>بنك التغريدات</h2><div className="row bank-row"><input value={bankUrl} onChange={(event) => setBankUrl(event.target.value)} placeholder="https://example.com/tweet-bank" dir="ltr" /><button onClick={() => void extract()}>استخراج الروابط</button></div><p className="muted">سيتم فتح البنك محليًا واستخراج روابط X وTwitter الفريدة حسب ترتيب ظهورها.</p></section>
      <section className="card"><div className="section-heading"><h2>Queue</h2><span className="session-progress">{state.queue.length} عنصر</span><button onClick={() => void act({ type: 'CLEAR_COMPLETED' })}>Clear Completed</button></div><div className="queue">{state.queue.map((item) => <QueueRow key={item.id} item={item} onAction={act} />)}{!state.queue.length && <p className="muted">لم تُستخرج روابط بعد.</p>}</div></section>
    </section>}

    {activeTab === 'workspaces' && <section className="tab-panel" role="tabpanel" aria-label="مساحات العمل">
      <section className="card"><div className="section-heading"><div><span className="eyebrow">PROJECTS</span><h2>كل مساحات العمل</h2></div><button className="primary" onClick={() => void createNewWorkspace()}>+ Workspace جديدة</button></div><p className="muted">المساحة النشطة: {activeWorkspace?.name ?? 'غير محددة'}{meta?.automationWorkspaceId ? ` · قيد التشغيل: ${workspaces.find((workspace) => workspace.id === meta.automationWorkspaceId)?.name ?? 'Workspace أخرى'}` : ''}</p></section>
      <div className="workspace-list">{workspaces.map((workspace) => <WorkspaceCard key={workspace.id} workspace={workspace} active={workspace.id === meta?.activeWorkspaceId} running={workspace.id === meta?.automationWorkspaceId} onOpen={() => void switchWorkspace(workspace.id)} onArchive={() => void archive(workspace.id)} onDelete={() => void remove(workspace)} />)}</div>
    </section>}

    {activeTab === 'settings' && <section className="tab-panel" role="tabpanel" aria-label="الإعدادات">
      <section className="card settings-card"><div className="settings-heading"><img src={logoUrl} alt="" /><div><span className="eyebrow">X-PILOT SETTINGS</span><h2>الإعدادات</h2></div></div><label>الفاصل بالدقائق<input type="number" min="0.5" step="0.5" value={settings.intervalMinutes} onChange={(event) => void updateSettings({ ...settings, intervalMinutes: Number(event.target.value) })} /></label><label>Maximum Retry Attempts<input type="number" min="0" max="10" value={settings.maxRetries} onChange={(event) => void updateSettings({ ...settings, maxRetries: Number(event.target.value) })} /></label><label className="check"><input type="checkbox" checked={settings.confirmBeforeStart} onChange={(event) => void updateSettings({ ...settings, confirmBeforeStart: event.target.checked })} /> تأكيد قبل بدء Queue</label><label className="check"><input type="checkbox" checked={settings.keepAutomationTabOpen} onChange={(event) => void updateSettings({ ...settings, keepAutomationTabOpen: event.target.checked })} /> إبقاء تبويب الأتمتة مفتوحًا</label><label className="check"><input type="checkbox" checked={settings.closeTabOnComplete} onChange={(event) => void updateSettings({ ...settings, closeTabOnComplete: event.target.checked })} /> إغلاق التبويب عند اكتمال Queue</label></section>
    </section>}
    <footer>لا تُخزن بيانات الدخول ولا تُرسل البيانات إلى Backend. عند ظهور Login أو CAPTCHA أو تحدٍ أمني تتوقف الإضافة.</footer>
  </main>;
}

function WorkspaceCard({ workspace, active, running, onOpen, onArchive, onDelete }: { workspace: Workspace; active: boolean; running: boolean; onOpen: () => void; onArchive: () => void; onDelete: () => void }) {
  return <article className={`workspace-card ${active ? 'active' : ''} ${workspace.archived ? 'archived' : ''}`}><div className="workspace-card-heading"><span className="workspace-icon" style={{ background: workspace.color ?? '#1d9bf0' }}>{workspace.icon ?? '◈'}</span><div><h3>{workspace.favorite ? '★ ' : ''}{workspace.name}</h3><p>{workspace.description || 'لا يوجد وصف'}</p></div></div><div className="workspace-card-stats"><span>{running ? '● يعمل الآن' : workspace.archived ? 'مؤرشف' : active ? 'نشط' : 'جاهز'}</span><span>آخر نشاط: {new Date(workspace.lastActivityAt).toLocaleDateString('ar')}</span></div><div className="workspace-card-actions"><button onClick={onOpen} disabled={workspace.archived}>فتح</button><button onClick={onArchive} disabled={workspace.archived || active}>أرشفة</button><button className="danger" onClick={onDelete} disabled={running}>حذف</button></div></article>;
}

function TabButton({ id, activeTab, onSelect, icon, label }: { id: TabId; activeTab: TabId; onSelect: (id: TabId) => void; icon: string; label: string }) { return <button className={`tab-button ${activeTab === id ? 'active' : ''}`} role="tab" aria-selected={activeTab === id} onClick={() => onSelect(id)}><span aria-hidden="true">{icon}</span>{label}</button>; }

function StatusIndicator({ kind, value, label }: { kind: 'connection' | 'engine'; value: string; label: string }) { return <span className={`live-indicator ${kind}-indicator ${kind}-${value}`}><span className="live-dot" aria-hidden="true" />{label}</span>; }
function connectionLabel(value: RuntimeStatus['connection']): string { return value === 'CONNECTED' ? 'متصل' : value === 'DISCONNECTED' ? 'غير متصل' : 'غير مطلوب'; }
function engineLabel(value: RuntimeStatus['engineStatus']): string { const labels: Record<RuntimeStatus['engineStatus'], string> = { IDLE: 'خامل', RUNNING: 'يعمل الآن', WAITING: 'في الانتظار', PAUSED: 'متوقف مؤقتًا', STOPPED: 'متوقف', COMPLETED: 'مكتمل', FAILED: 'فشل' }; return labels[value]; }

function CurrentTweetCard({ item, position, logoUrl }: { item?: QueueItem; position?: number; logoUrl: string }) { return <section className="card current-card"><div className="current-heading"><div className="current-brand"><img src={logoUrl} alt="" /><div><span className="eyebrow">CURRENT TWEET</span><h2>التغريدة الحالية</h2></div></div>{item && <span className={`item-status status-${item.status}`}>{item.status}</span>}</div>{item ? <><p className="current-preview" dir="auto">{getTweetPreview(item.targetUrl, item.label, 180)}</p><div className="current-meta"><span>العنصر {position ?? item.position}</span><span>المحاولات {item.attempts}</span>{item.startedAt && <span>بدأت {new Date(item.startedAt).toLocaleTimeString('ar')}</span>}</div>{item.lastError && <p className="error-text">آخر خطأ: {item.lastError}</p>}<a className="primary-link" href={item.targetUrl} target="_blank" rel="noreferrer">فتح رابط التغريدة</a></> : <p className="muted">لا توجد تغريدة قيد التشغيل حاليًا. ابدأ Queue من تبويب التشغيل.</p>}</section>; }

function RecoveryCard({ logoUrl, onResume }: { logoUrl: string; onResume: () => void }) { return <section className="card recovery-card"><div className="current-brand"><img src={logoUrl} alt="" /><div><span className="eyebrow">X-PILOT RECOVERY</span><h2>استعادة Queue</h2></div></div><p className="muted">توجد عناصر غير مكتملة من جلسة سابقة. يمكنك استئناف النشر من العنصر الحالي.</p><button className="primary" onClick={onResume}>استئناف Queue</button></section>; }

function formatCountdown(totalSeconds: number): string { const hours = Math.floor(totalSeconds / 3600); const minutes = Math.floor((totalSeconds % 3600) / 60); const seconds = totalSeconds % 60; return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`; }
function pad(value: number): string { return String(value).padStart(2, '0'); }

function QueueRow({ item, onAction }: { item: QueueItem; onAction: (message: RuntimeMessage, success?: string) => Promise<void> }) { return <div className="queue-row"><span className="position">{item.position}</span><div className="item-main"><div className="preview" dir="auto">{getTweetPreview(item.targetUrl, item.label)}</div><a className="source-link" href={item.targetUrl} target="_blank" rel="noreferrer">فتح رابط التجهيز</a><small>{item.status} · attempts: {item.attempts}{item.lastError ? ` · ${item.lastError}` : ''}</small></div><div className="item-actions"><button aria-label="تحريك لأعلى" onClick={() => void onAction({ type: 'REORDER', itemId: item.id, direction: 'up' })}>↑</button><button aria-label="تحريك لأسفل" onClick={() => void onAction({ type: 'REORDER', itemId: item.id, direction: 'down' })}>↓</button><button aria-label="إعادة المحاولة" onClick={() => void onAction({ type: 'RETRY_ITEM', itemId: item.id })}>↻</button><button aria-label="حذف" onClick={() => void onAction({ type: 'DELETE_ITEM', itemId: item.id })}>×</button></div></div>; }

createRoot(document.getElementById('root')!).render(<App />);
