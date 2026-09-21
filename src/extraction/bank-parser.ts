export interface ExtractedLink {
  url: string;
  label?: string;
}

export interface ExtractionResult {
  links: ExtractedLink[];
  invalidLinks: ExtractedLink[];
  duplicateCount: number;
  invalidCount: number;
}

const allowedHosts = new Set(['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com']);
const candidatePattern = /(?:https?:\/\/)(?:www\.)?(?:x\.com|twitter\.com)\/[^\s"'<>\\]+/gi;

function decodeMarkup(value: string): string {
  return value
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&amp;|&#38;|&#x26;/gi, '&')
    .replace(/&apos;|&#39;|&#x27;/gi, "'")
    .replace(/&lt;|&#60;|&#x3c;/gi, '<')
    .replace(/&gt;|&#62;|&#x3e;/gi, '>')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/');
}

function isCandidate(raw: string): boolean {
  return /(?:x\.com|twitter\.com)\//i.test(raw);
}

export function normalizeTargetUrl(raw: string): string | null {
  try {
    const cleaned = decodeMarkup(raw).replace(/[\\]$/g, '').trim();
    const url = new URL(cleaned);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (!allowedHosts.has(host)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function extractLinksFromValues(values: Array<{ raw: string; label?: string }>): ExtractionResult {
  const links: ExtractedLink[] = [];
  const invalidLinks: ExtractedLink[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  let invalidCount = 0;

  for (const value of values) {
    const candidates = value.raw.match(candidatePattern) ?? [value.raw];
    for (const candidate of candidates) {
      if (!isCandidate(candidate)) continue;
      const normalized = normalizeTargetUrl(candidate);
      if (!normalized) {
        invalidCount += 1;
        invalidLinks.push({ url: candidate, label: value.label });
        continue;
      }
      if (seen.has(normalized)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(normalized);
      links.push({ url: normalized, label: value.label });
    }
  }
  return { links, invalidLinks, duplicateCount, invalidCount };
}

export function extractLinksFromMarkup(markup: string): ExtractionResult {
  return extractLinksFromValues([{ raw: decodeMarkup(markup) }]);
}

export function extractLinks(doc: Document): ExtractionResult {
  const values: Array<{ raw: string; label?: string }> = [];
  for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    values.push({ raw: anchor.href, label: anchor.textContent?.trim() || undefined });
  }
  values.push({ raw: doc.documentElement.outerHTML });
  return extractLinksFromValues(values);
}
