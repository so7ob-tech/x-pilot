export type LanguagePreference = 'AUTO' | 'AR' | 'EN';
export type Locale = 'ar' | 'en';

export type TranslationTree = {
  common: Record<string, string>;
  nav: Record<string, string>;
  actions: Record<string, string>;
  statuses: Record<string, string>;
  errors: Record<string, string>;
  settings: Record<string, string>;
  operation: Record<string, string>;
  queue: Record<string, string>;
  banks: Record<string, string>;
  tests: Record<string, string>;
  analytics: Record<string, string>;
  diagnostics: Record<string, string>;
  workspaces: Record<string, string>;
};
