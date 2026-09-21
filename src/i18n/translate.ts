import { ar } from './ar.ts';
import { en } from './en.ts';
import type { Locale, TranslationTree } from './types.ts';

export function lookupTranslation(tree: TranslationTree, path: string): string {
  return path.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)?.[part], tree) as string || path;
}

export function translateForLocale(locale: Locale, path: string, variables: Record<string, string | number> = {}): string {
  const dictionary = locale === 'ar' ? ar : en;
  const text = lookupTranslation(dictionary, path);
  return Object.entries(variables).reduce((current, [key, value]) => current.replaceAll(`{{${key}}}`, String(value)), text);
}

export function localeFromLanguage(language: string | undefined): Locale {
  return language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function formatDateTimeForLocale(value: number | Date | string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-YE' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export async function getStoredLocale(): Promise<Locale> {
  try {
    const stored = await globalThis.chrome?.storage?.local?.get('xPilotUiPreferences') as Record<string, { language?: string }> | undefined;
    const preference = stored?.xPilotUiPreferences?.language;
    if (preference === 'AR') return 'ar';
    if (preference === 'EN') return 'en';
  } catch { /* use browser locale */ }
  try {
    const language = globalThis.chrome?.i18n?.getUILanguage?.() ?? globalThis.navigator?.language;
    return localeFromLanguage(language);
  } catch {
    return 'en';
  }
}
