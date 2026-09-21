import { useSyncExternalStore } from 'react';
import { ar } from './ar.ts';
import { en } from './en.ts';
import type { LanguagePreference, Locale, TranslationTree } from './types.ts';

export type { LanguagePreference, Locale } from './types';
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
  return language.toLowerCase().startsWith('ar') ? 'ar' : 'en';
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

function dictionary(): TranslationTree { return locale === 'ar' ? ar : en; }
function lookup(path: string): string { return path.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)?.[part], dictionary()) as string || path; }
export function translate(path: string, variables: Record<string, string | number> = {}): string {
  return Object.entries(variables).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)), lookup(path));
}

export function useI18n() {
  const currentLocale = useSyncExternalStore(subscribe, getLocale, getLocale);
  if (!initialized && typeof window !== 'undefined') void loadLanguagePreference();
  return { locale: currentLocale, language: preference, t: translate, setLanguage: setLanguagePreference };
}

if (typeof document !== 'undefined') applyLocale(locale);
