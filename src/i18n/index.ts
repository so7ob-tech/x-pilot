import { useSyncExternalStore } from 'react';
import type { LanguagePreference, Locale, TranslationTree } from './types.ts';
import { formatDateTimeForLocale, localeFromLanguage, translateForLocale } from './translate.ts';

export type { LanguagePreference, Locale } from './types';
export { translateForLocale, localeFromLanguage } from './translate.ts';
export { formatDateTimeForLocale } from './translate.ts';
export const UI_PREFERENCES_KEY = 'xPilotUiPreferences';

let preference: LanguagePreference = 'AUTO';
let locale: Locale = resolveLocale(preference);
let initialized = false;
const listeners = new Set<() => void>();

function browserLanguage(): string {
  try {
    const chromeLanguage = globalThis.chrome?.i18n?.getUILanguage?.();
    if (chromeLanguage) return chromeLanguage;
  } catch { /* non-extension context */ }
  return globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language ?? 'en';
}

export function resolveLocale(value: LanguagePreference, language = browserLanguage()): Locale {
  if (value === 'AR') return 'ar';
  if (value === 'EN') return 'en';
  return localeFromLanguage(language);
}

export function applyLocale(next: Locale): void {
  locale = next;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
    document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
  }
  listeners.forEach((listener) => listener());
}

export function getLanguagePreference(): LanguagePreference { return preference; }
export function getLocale(): Locale { return locale; }
export function subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

export async function loadLanguagePreference(): Promise<LanguagePreference> {
  try {
    const stored = await globalThis.chrome?.storage?.local?.get(UI_PREFERENCES_KEY) as Record<string, { language?: unknown }> | undefined;
    const value = stored?.[UI_PREFERENCES_KEY]?.language;
    if (value === 'AR' || value === 'EN' || value === 'AUTO') preference = value;
  } catch { /* keep AUTO */ }
  applyLocale(resolveLocale(preference));
  initialized = true;
  return preference;
}

export async function setLanguagePreference(next: LanguagePreference): Promise<void> {
  preference = next;
  await globalThis.chrome?.storage?.local?.set({ [UI_PREFERENCES_KEY]: { language: next } });
  applyLocale(resolveLocale(next));
}

export function translate(path: string, variables: Record<string, string | number> = {}): string {
  return translateForLocale(locale, path, variables);
}

export function formatDateTime(value: number | Date | string, currentLocale = locale): string {
  return formatDateTimeForLocale(value, currentLocale);
}
export function formatDate(value: number | Date | string, currentLocale = locale): string {
  return new Intl.DateTimeFormat(currentLocale === 'ar' ? 'ar-YE' : 'en-US', { dateStyle: 'medium' }).format(new Date(value));
}
export function formatTime(value: number | Date | string, currentLocale = locale): string {
  return new Intl.DateTimeFormat(currentLocale === 'ar' ? 'ar-YE' : 'en-US', { timeStyle: 'short' }).format(new Date(value));
}
export function formatNumber(value: number, currentLocale = locale): string {
  return new Intl.NumberFormat(currentLocale === 'ar' ? 'ar-YE' : 'en-US').format(value);
}

export function useI18n() {
  const currentLocale = useSyncExternalStore(subscribe, getLocale, getLocale);
  if (!initialized && typeof window !== 'undefined') void loadLanguagePreference();
  return { locale: currentLocale, language: preference, t: translate, setLanguage: setLanguagePreference };
}

if (typeof document !== 'undefined') applyLocale(locale);
