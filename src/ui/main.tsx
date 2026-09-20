import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppState, QueueItem, RuntimeMessage, Settings } from '../domain/models';
import { defaultSettings } from '../domain/models';
import './styles.css';

const initialState: AppState = { queue: [], session: null, history: [] };

function send(message: RuntimeMessage): Promise<any> { return chrome.runtime.sendMessage(message); }

function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [bankUrl, setBankUrl] = useState('');
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [notice, setNotice] = useState('');
  const session = state.session;
  const published = useMemo(() => state.queue.filter((item) => item.status === 'PUBLISHED' || item.status === 'PUBLISHED_UNVERIFIED').length, [state.queue]);
  const failed = useMemo(() => state.queue.filter((item) => item.status === 'FAILED').length, [state.queue]);
  const remaining = state.queue.length - published - failed;

  const refresh = async () => { const next = await send({ type: 'GET_STATE' }); if (next && !next.error) setState(next); };
  useEffect(() => { void refresh(); const listener = (message: any) => { if (message.type === 'STATE_UPDATED') setState(message.state); }; chrome.runtime.onMessage.addListener(listener); return () => chrome.runtime.onMessage.removeListener(listener); }, []);
  const act = async (message: RuntimeMessage, success?: string) => { const result = await send(message); if (result?.error) setNotice(result.error); else { if (result?.queue) setState(result); else await refresh(); if (success) setNotice(success); } };
  const extract = async () => {
    if (!bankUrl.trim()) return setNotice('أدخل رابط بنك التغريدات أولًا');
    let parsed: URL;
    try { parsed = new URL(bankUrl.trim()); } catch { return setNotice('رابط البنك غير صالح'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return setNotice('يجب أن يبدأ رابط البنك بـ http أو https');
    const originPattern = `${parsed.protocol}//${parsed.host}/*`;
    const granted = await chrome.permissions.request({ origins: [originPattern] });
    if (!granted) return setNotice('لم يتم منح صلاحية قراءة نطاق بنك التغريدات');
    await act({ type: 'EXTRACT_BANK', bankUrl: bankUrl.trim() }, 'تم استخراج الروابط');
  };
  const start = async () => { if (settings.confirmBeforeStart && !window.confirm(`بدء نشر ${remaining} عنصر؟`)) return; await act({ type: 'START', confirmed: true }, 'بدأت الجلسة'); };
  const updateSettings = async (next: Settings) => { setSettings(next); await act({ type: 'UPDATE_SETTINGS', settings: next }); };
  return <main className="shell">
    <header><div><span className="eyebrow">LOCAL-FIRST · MV3</span><h1>قائمة نشر X</h1></div><span className={`status status-${session?.status ?? 'IDLE'}`}>{session?.status ?? 'IDLE'}</span></header>
    {notice && <div className="notice">{notice}</div>}
    <section className="card"><h2>بنك التغريدات</h2><div className="row"><input value={bankUrl} onChange={(event) => setBankUrl(event.target.value)} placeholder="https://example.com/tweet-bank" dir="ltr" /><button onClick={extract}>استخراج الروابط</button></div><p className="muted">سيتم فتح البنك محليًا واستخراج روابط X وTwitter الفريدة حسب ترتيب ظهورها.</p></section>
    <section className="stats"><div><b>{state.queue.length}</b><span>الإجمالي</span></div><div><b>{published}</b><span>منشور</span></div><div><b>{failed}</b><span>فشل</span></div><div><b>{remaining}</b><span>متبقٍ</span></div></section>
    <section className="card controls"><h2>التشغيل</h2><div className="row"><button className="primary" onClick={start} disabled={!state.queue.length || session?.status === 'RUNNING'}>Start</button><button onClick={() => act({ type: 'PAUSE' })}>Pause</button><button onClick={() => act({ type: 'RESUME' })}>Resume</button><button className="danger" onClick={() => act({ type: 'STOP' })}>Stop</button></div><p className="muted">العنصر الحالي: {session?.currentItemId ? state.queue.find((item) => item.id === session.currentItemId)?.position ?? '-' : '-'}</p></section>
    <section className="card"><h2>الإعدادات</h2><label>الفاصل بالدقائق<input type="number" min="0.5" step="0.5" value={settings.intervalMinutes} onChange={(event) => void updateSettings({ ...settings, intervalMinutes: Number(event.target.value) })} /></label><label>Maximum Retry Attempts<input type="number" min="0" max="10" value={settings.maxRetries} onChange={(event) => void updateSettings({ ...settings, maxRetries: Number(event.target.value) })} /></label><label className="check"><input type="checkbox" checked={settings.confirmBeforeStart} onChange={(event) => void updateSettings({ ...settings, confirmBeforeStart: event.target.checked })} /> تأكيد قبل بدء Queue</label></section>
    <section className="card"><div className="section-heading"><h2>Queue</h2><button onClick={() => act({ type: 'CLEAR_COMPLETED' })}>Clear Completed</button></div><div className="queue">{state.queue.map((item) => <QueueRow key={item.id} item={item} onAction={act} />)}{!state.queue.length && <p className="muted">لم تُستخرج روابط بعد.</p>}</div></section>
    <footer>لا تُخزن بيانات الدخول ولا تُرسل البيانات إلى Backend. عند ظهور Login أو CAPTCHA أو تحدٍ أمني تتوقف الإضافة.</footer>
  </main>;
}

function QueueRow({ item, onAction }: { item: QueueItem; onAction: (message: RuntimeMessage, success?: string) => Promise<void> }) { return <div className="queue-row"><span className="position">{item.position}</span><div className="item-main"><a href={item.targetUrl} target="_blank" rel="noreferrer" dir="ltr">{item.label || item.targetUrl}</a><small>{item.status} · attempts: {item.attempts}{item.lastError ? ` · ${item.lastError}` : ''}</small></div><div className="item-actions"><button onClick={() => void onAction({ type: 'REORDER', itemId: item.id, direction: 'up' })}>↑</button><button onClick={() => void onAction({ type: 'REORDER', itemId: item.id, direction: 'down' })}>↓</button><button onClick={() => void onAction({ type: 'RETRY_ITEM', itemId: item.id })}>↻</button><button onClick={() => void onAction({ type: 'DELETE_ITEM', itemId: item.id })}>×</button></div></div>; }

createRoot(document.getElementById('root')!).render(<App />);
