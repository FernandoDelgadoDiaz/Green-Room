// Minimal RSS reader shared by the catalog builder: channel metadata and item title/date/link only.
// Episode descriptions are third-party content and are not kept.

import { XMLParser } from 'fast-xml-parser';

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)['#text']);
  return '';
}

function cleanUrl(u: string): string | null {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    for (const k of [...url.searchParams.keys()]) if (k.startsWith('utm_')) url.searchParams.delete(k);
    return url.toString();
  } catch {
    return null;
  }
}

export interface FeedItem {
  guid: string;
  title: string;
  published: string;
  url: string | null;
}

export interface ParsedFeed {
  title: string;
  language: string;
  description: string;
  author: string;
  items: FeedItem[];
}

/** "es-MX", "<![CDATA[es]]>", "en-us" → "es" / "en". */
export function baseLanguage(raw: string): string {
  return raw.replace(/<!\[CDATA\[|\]\]>/g, '').trim().toLowerCase().split(/[-_]/)[0] || 'und';
}

export function parseFeed(xml: string, maxItems = 500): ParsedFeed {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: false, cdataPropName: false as unknown as string });
  const ch = parser.parse(xml)?.rss?.channel ?? {};
  const raw = Array.isArray(ch.item) ? ch.item : ch.item ? [ch.item] : [];
  const clean = (s: string) => decodeEntities(s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const items: FeedItem[] = (raw as Record<string, unknown>[])
    .map((it, i) => {
      const d = new Date(text(it.pubDate));
      return { guid: clean(text(it.guid)) || `item-${i}`, title: clean(text(it.title)), published: isNaN(d.getTime()) ? '' : d.toISOString(), url: cleanUrl(clean(text(it.link))) };
    })
    .filter((x) => x.title)
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, maxItems);
  return {
    title: clean(text(ch.title)),
    language: baseLanguage(text(ch.language)),
    description: clean(text(ch.description) || text(ch['itunes:summary'])),
    author: clean(text(ch['itunes:author'])),
    items,
  };
}
