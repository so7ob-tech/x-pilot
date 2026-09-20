import type { ContentInspection } from '../../domain/models';

const composerSelectors = [
  '[data-testid="tweetTextarea_0"]',
  '[contenteditable="true"][role="textbox"]',
  'div[role="textbox"][contenteditable="true"]',
  '[data-testid="tweetTextarea_0"] [contenteditable="true"]',
  'textarea[aria-label*="Post"]',
  'textarea[aria-label*="Tweet"]',
  'textarea[aria-label*="نص المنشور"]',
  'textarea[aria-label*="منشور"]',
  'textarea[placeholder*="Post"]',
  'textarea[placeholder*="Tweet"]',
  'textarea[placeholder*="منشور"]'
];

const postButtonSelectors = [
  '[data-testid="tweetButtonInline"]',
  '[data-testid="tweetButton"]',
  'button[data-testid*="tweetButton"]',
  'button[aria-label="Post"]',
  'button[aria-label="Tweet"]',
  'button[aria-label="نشر"]',
  'button[aria-label="غرد"]'
];

function findFirst(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) return element;
  }
  return null;
}

function readText(element: HTMLElement): string {
  return (element instanceof HTMLTextAreaElement ? element.value : element.innerText || element.textContent || '').trim();
}

export function isPublishButtonLabel(value: string): boolean {
  const label = value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
  return ['post', 'tweet', 'نشر', 'غرد'].includes(label);
}

function findPostButton(): HTMLElement | null {
  const selected = findFirst(postButtonSelectors);
  if (selected && isPublishButtonLabel(readText(selected) || selected.getAttribute('aria-label') || '')) return selected;
  return Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"]')).find((button) => {
    const label = readText(button) || button.getAttribute('aria-label') || '';
    return isPublishButtonLabel(label);
  }) ?? null;
}

export function inspect(): ContentInspection {
  const host = location.hostname.toLowerCase();
  if (!['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(host)) {
    return { ok: false, pageKind: 'UNKNOWN', composerFound: false, contentPresent: false, postButtonFound: false, postButtonEnabled: false, reason: 'WRONG_HOST' };
  }
  const body = document.body?.innerText?.toLowerCase() ?? '';
  if (location.pathname.startsWith('/i/flow/login') || body.includes('log in to x') || body.includes('تسجيل الدخول')) {
    return { ok: false, pageKind: 'LOGIN', composerFound: false, contentPresent: false, postButtonFound: false, postButtonEnabled: false, reason: 'NOT_LOGGED_IN' };
  }
  if (body.includes('captcha') || body.includes('challenge')) {
    return { ok: false, pageKind: 'CHALLENGE', composerFound: false, contentPresent: false, postButtonFound: false, postButtonEnabled: false, reason: 'CAPTCHA_OR_SECURITY_CHALLENGE' };
  }
  const composer = findFirst(composerSelectors);
  const postButton = findPostButton();
  const contentPresent = composer ? readText(composer).length > 0 : false;
  const postButtonEnabled = Boolean(postButton && !postButton.hasAttribute('disabled') && postButton.getAttribute('aria-disabled') !== 'true');
  const ok = Boolean(composer && contentPresent && postButton && postButtonEnabled);
  return { ok, pageKind: 'X', composerFound: Boolean(composer), contentPresent, postButtonFound: Boolean(postButton), postButtonEnabled, reason: ok ? undefined : 'PUBLISH_CONTROLS_NOT_READY' };
}

export function publish(): ContentInspection {
  const state = inspect();
  if (!state.ok) return state;
  const button = findPostButton();
  if (!button) return { ...state, ok: false, postButtonFound: false, reason: 'POST_BUTTON_NOT_FOUND' };
  button.click();
  return { ...state, ok: true };
}
