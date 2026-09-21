export type BadgeMode = 'COUNT' | 'STATUS' | 'NONE';

export interface PublishingWindow {
  id: string;
  days: number[];
  start: string;
  end: string;
  enabled: boolean;
}

export interface WorkspaceAutomationProfile {
  intervalMinutes: number;
  maxRetries: number;
  failureBehavior: 'CONTINUE' | 'PAUSE';
  duplicatePolicy: 'BLOCK' | 'WARN' | 'ALLOW';
  publishingWindows: PublishingWindow[];
  timezone: string;
  confirmBeforeStart: boolean;
  keepAutomationTabOpen: boolean;
  closeTabOnComplete: boolean;
}

export const defaultPublishingWindows: PublishingWindow[] = [];
export const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function parts(timestamp: number, timezone: string) {
  const values = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(timestamp);
  const map = Object.fromEntries(values.map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: weekdays[map.weekday] ?? 0, hour: Number(map.hour) % 24, minute: Number(map.minute), year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function minutes(value: string): number | undefined {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value);
  if (!match) return undefined;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function windowContains(timestamp: number, timezone: string, window: PublishingWindow): boolean {
  if (!window.enabled) return false;
  const start = minutes(window.start); const end = minutes(window.end);
  if (start === undefined || end === undefined) return false;
  const current = parts(timestamp, timezone); const currentMinutes = current.hour * 60 + current.minute;
  if (window.days.includes(current.weekday) && (start === end ? currentMinutes === start : start < end ? currentMinutes >= start && currentMinutes < end : currentMinutes >= start)) return true;
  if (start > end) {
    const previousDay = (current.weekday + 6) % 7;
    if (window.days.includes(previousDay) && currentMinutes < end) return true;
  }
  return false;
}

export function isWithinPublishingWindow(timestamp: number, timezone: string, windows: PublishingWindow[]): boolean {
  const enabled = windows.filter((window) => window.enabled);
  return enabled.length === 0 || enabled.some((window) => windowContains(timestamp, timezone, window));
}

export function getNextAllowedPublishingTime(now: number, timezone: string, windows: PublishingWindow[]): number | undefined {
  const enabled = windows.filter((window) => window.enabled);
  if (enabled.length === 0 || isWithinPublishingWindow(now, timezone, enabled)) return now;
  const step = 60_000;
  for (let candidate = now + step; candidate <= now + 8 * 24 * 60 * step; candidate += step) {
    if (isWithinPublishingWindow(candidate, timezone, enabled)) return candidate;
  }
  return undefined;
}

export function profileFromSettings(settings: { intervalMinutes: number; maxRetries: number; failureBehavior: 'CONTINUE' | 'PAUSE'; duplicatePolicy: 'BLOCK' | 'WARN' | 'ALLOW'; confirmBeforeStart: boolean; keepAutomationTabOpen: boolean; closeTabOnComplete: boolean; }, timezone = localTimezone()): WorkspaceAutomationProfile {
  return { ...settings, publishingWindows: [], timezone };
}
