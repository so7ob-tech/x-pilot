export interface ExtractedLink {
  url: string;
  label?: string;
}

export interface ExtractionResult {
  links: ExtractedLink[];
  duplicateCount: number;
  invalidCount: number;
}

const allowedHosts = new Set(['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com']);

export function normalizeTargetUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (!allowedHosts.has(host)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function extractLinks(doc: Document): ExtractionResult {
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  let invalidCount = 0;

  for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const normalized = normalizeTargetUrl(anchor.href);
    if (!normalized) {
      if (anchor.href.trim()) invalidCount += 1;
      continue;
    }
    if (seen.has(normalized)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(normalized);
    const label = anchor.textContent?.trim() || undefined;
    links.push({ url: normalized, label });
  }
  return { links, duplicateCount, invalidCount };
}
