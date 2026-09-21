import { useEffect, useMemo, useState } from 'react';
import type { PublishingWindow } from '../../domain/scheduling';
import { useI18n } from '../../i18n';

const DAYS = [0, 1, 2, 3, 4, 5, 6];

const newWindow = (): PublishingWindow => ({ id: `window-${Date.now()}-${Math.random().toString(16).slice(2)}`, days: [0, 1, 2, 3, 4], start: '09:00', end: '17:00', enabled: true });

export function PublishingWindowsEditor({ windows, onSave }: { windows: PublishingWindow[]; onSave: (windows: PublishingWindow[]) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<PublishingWindow[]>(windows);
  const [notice, setNotice] = useState('');

  useEffect(() => setDraft(windows), [windows]);

  const validation = useMemo(() => {
    if (!draft.length) return '';
    if (draft.some((window) => !window.days.length)) return t('publishingWindows.chooseDays');
    if (draft.some((window) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.end))) return t('publishingWindows.invalidTimes');
    return '';
  }, [draft, t]);

  const updateWindow = (id: string, patch: Partial<PublishingWindow>) => setDraft((current) => current.map((window) => window.id === id ? { ...window, ...patch } : window));
  const toggleDay = (window: PublishingWindow, day: number) => updateWindow(window.id, { days: window.days.includes(day) ? window.days.filter((value) => value !== day) : [...window.days, day].sort((a, b) => a - b) });
  const save = () => { if (validation) { setNotice(validation); return; } onSave(draft); setNotice(t('publishingWindows.saved')); };

  return <section className="publishing-windows-editor" aria-label={t('publishingWindows.title')}><div className="publishing-windows-heading"><div><h3>{t('publishingWindows.title')}</h3><p className="muted">{t('publishingWindows.hint')}</p></div><button type="button" onClick={() => { setDraft((current) => [...current, newWindow()]); setNotice(''); }}>+ {t('publishingWindows.add')}</button></div>{!draft.length ? <div className="publishing-windows-empty"><strong>{t('publishingWindows.allDay')}</strong><span>{t('publishingWindows.emptyHint')}</span></div> : <div className="publishing-window-list">{draft.map((window, index) => <article className={`publishing-window-row ${window.enabled ? '' : 'disabled'}`} key={window.id}><div className="publishing-window-top"><strong>{t('publishingWindows.window')} {index + 1}</strong><label className="window-toggle"><input type="checkbox" checked={window.enabled} onChange={(event) => updateWindow(window.id, { enabled: event.target.checked })} /> {t('publishingWindows.enabled')}</label><button type="button" className="danger window-delete" onClick={() => setDraft((current) => current.filter((item) => item.id !== window.id))}>{t('publishingWindows.remove')}</button></div><div className="day-picker" role="group" aria-label={`${t('publishingWindows.window')} ${index + 1}`}>{DAYS.map((day) => <button type="button" className={window.days.includes(day) ? 'selected' : ''} aria-pressed={window.days.includes(day)} title={t(`publishingWindows.day${day}`)} key={day} onClick={() => toggleDay(window, day)}>{t(`publishingWindows.day${day}`).slice(0, 2)}</button>)}</div><div className="window-times"><label>{t('publishingWindows.from')}<input type="time" value={window.start} onChange={(event) => updateWindow(window.id, { start: event.target.value })} /></label><span aria-hidden="true">→</span><label>{t('publishingWindows.to')}<input type="time" value={window.end} onChange={(event) => updateWindow(window.id, { end: event.target.value })} /></label></div></article>)}</div>}{(validation || notice) && <p className={validation ? 'window-error' : 'window-success'} role="status">{validation || notice}</p>}<button type="button" className="primary publishing-windows-save" onClick={save} disabled={Boolean(validation)}>{t('publishingWindows.save')}</button></section>;
}
