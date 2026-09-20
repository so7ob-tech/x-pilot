export function getTweetPreview(targetUrl: string, label?: string, maxLength = 120): string {
  try {
    const url = new URL(targetUrl);
    const text = url.searchParams.get('text')?.replace(/\s+/gu, ' ').trim();
    if (text) return truncate(text, maxLength);
  } catch {
    // Fall back to the bank label when the URL cannot be parsed.
  }
  return truncate(label?.replace(/\s+/gu, ' ').trim() || 'منشور X جاهز للنشر', maxLength);
}

function truncate(value: string, maxLength: number): string {
  const characters = Array.from(value);
  return characters.length > maxLength ? `${characters.slice(0, maxLength - 1).join('')}…` : value;
}
