const HTML_ENTITIES: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };

export function decodeText(value: string): string {
  return value.replace(/&(?:amp|quot|#39|lt|gt);/gi, (entity) => HTML_ENTITIES[entity.toLowerCase()] ?? entity);
}

export function normalizeTweetContent(value: string): string {
  return decodeText(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\t\r\n ]+/g, ' ')
    .trim();
}

export function extractTweetContent(targetUrl: string, fallbackLabel?: string): string | null {
  try {
    const url = new URL(targetUrl);
    const text = url.searchParams.get('text') ?? url.searchParams.get('full_text') ?? url.searchParams.get('tweet_text') ?? fallbackLabel;
    if (!text) return null;
    const normalized = normalizeTweetContent(text);
    return normalized || null;
  } catch {
    return fallbackLabel ? normalizeTweetContent(fallbackLabel) || null : null;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintTweet(targetUrl: string, fallbackLabel?: string): Promise<{ content: string; fingerprint: string } | null> {
  const content = extractTweetContent(targetUrl, fallbackLabel);
  return content ? { content, fingerprint: await sha256Hex(content) } : null;
}
