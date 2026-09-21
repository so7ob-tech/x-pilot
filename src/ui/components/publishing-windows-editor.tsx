import { useEffect, useMemo, useState } from 'react';
import type { PublishingWindow } from '../../domain/scheduling';

const DAYS = [
  { value: 0, label: 'الأحد', short: 'أح' },
  { value: 1, label: 'الاثنين', short: 'إث' },
  { value: 2, label: 'الثلاثاء', short: 'ثل' },
  { value: 3, label: 'الأربعاء', short: 'أر' },
  { value: 4, label: 'الخميس', short: 'خم' },
  { value: 5, label: 'الجمعة', short: 'جم' },
  { value: 6, label: 'السبت', short: 'سب' },
];

const newWindow = (): PublishingWindow => ({ id: `window-${Date.now()}-${Math.random().toString(16).slice(2)}`, days: [0, 1, 2, 3, 4], start: '09:00', end: '17:00', enabled: true });

export function PublishingWindowsEditor({ windows, onSave }: { windows: PublishingWindow[]; onSave: (windows: PublishingWindow[]) => void }) {
  const [draft, setDraft] = useState<PublishingWindow[]>(windows);
  const [notice, setNotice] = useState('');

  useEffect(() => setDraft(windows), [windows]);

  const validation = useMemo(() => {
    if (!draft.length) return '';
    if (draft.some((window) => !window.days.length)) return 'اختر يومًا واحدًا على الأقل لكل نافذة.';
    if (draft.some((window) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.end))) return 'تأكد من صحة أوقات البداية والنهاية.';
    return '';
  }, [draft]);

  const updateWindow = (id: string, patch: Partial<PublishingWindow>) => setDraft((current) => current.map((window) => window.id === id ? { ...window, ...patch } : window));
  const toggleDay = (window: PublishingWindow, day: number) => updateWindow(window.id, { days: window.days.includes(day) ? window.days.filter((value) => value !== day) : [...window.days, day].sort((a, b) => a - b) });
  const save = () => { if (validation) { setNotice(validation); return; } onSave(draft); setNotice('تم حفظ نوافذ النشر'); };

  return <section className="publishing-windows-editor" aria-label="نوافذ النشر"><div className="publishing-windows-heading"><div><h3>Publishing Windows</h3><p className="muted">حدد الأيام والساعات المسموح فيها بالنشر حسب المنطقة الزمنية أعلاه.</p></div><button type="button" onClick={() => { setDraft((current) => [...current, newWindow()]); setNotice(''); }}>+ إضافة نافذة</button></div>{!draft.length ? <div className="publishing-windows-empty"><strong>النشر مسموح طوال اليوم</strong><span>أضف نافذة إذا أردت تقييد النشر بأيام أو ساعات محددة.</span></div> : <div className="publishing-window-list">{draft.map((window, index) => <article className={`publishing-window-row ${window.enabled ? '' : 'disabled'}`} key={window.id}><div className="publishing-window-top"><strong>نافذة {index + 1}</strong><label className="window-toggle"><input type="checkbox" checked={window.enabled} onChange={(event) => updateWindow(window.id, { enabled: event.target.checked })} /> مفعلة</label><button type="button" className="danger window-delete" onClick={() => setDraft((current) => current.filter((item) => item.id !== window.id))}>حذف</button></div><div className="day-picker" role="group" aria-label={`أيام نافذة ${index + 1}`}>{DAYS.map((day) => <button type="button" className={window.days.includes(day.value) ? 'selected' : ''} aria-pressed={window.days.includes(day.value)} title={day.label} key={day.value} onClick={() => toggleDay(window, day.value)}>{day.short}</button>)}</div><div className="window-times"><label>من<input type="time" value={window.start} onChange={(event) => updateWindow(window.id, { start: event.target.value })} /></label><span aria-hidden="true">→</span><label>إلى<input type="time" value={window.end} onChange={(event) => updateWindow(window.id, { end: event.target.value })} /></label></div></article>)}</div>}{(validation || notice) && <p className={validation ? 'window-error' : 'window-success'} role="status">{validation || notice}</p>}<button type="button" className="primary publishing-windows-save" onClick={save} disabled={Boolean(validation)}>حفظ نوافذ النشر</button></section>;
}
