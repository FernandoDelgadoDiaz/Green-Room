// What an interview was about, as a phrase that can sit inside a sentence: episode titles carry
// hashtags, leading dashes, "sobre…", and dangling "with" once the guest's own name is removed.

const WRAPPING_QUOTES = /^["“”'«‘](.*)["“”'»’]$/s;
const LEADING_PUNCT = /^(?:[-–—|&·•:,;.]+\s*)+/;
const LEADING_ABOUT = /^(?:sobre|acerca de|about|on|discusses|discussing|talks about|talking about|habla de|habla sobre|hablamos de|hablamos con)\s+/i;
// "& Gwynne Shotwell on AI Risks…" once "Elon Musk" was removed from the title.
const CO_GUEST_ON = /^&\s*[^,:]{2,40}?\s+(?:on|sobre)\s+/i;
const TRAILING = /\s*(?:\b(?:with|con|and|y|feat\.?|ft\.?|in conversation)|[&,:;|·–—-])\s*$/i;

export function cleanTopic(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let t = raw.replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/…$/, '').trim();
  t = t.replace(CO_GUEST_ON, '');
  for (let i = 0; i < 3; i++) t = t.replace(LEADING_PUNCT, '').replace(LEADING_ABOUT, '').trim();
  for (let i = 0; i < 3; i++) t = t.replace(TRAILING, '').trim();
  const q = WRAPPING_QUOTES.exec(t);
  if (q) t = q[1].trim();
  // "Tariff Reactions with and Antonio Gracias" once the guest's name was removed.
  t = t.replace(/\b(with|con)\s+(?:and|y|&)\s+/gi, '$1 ').replace(/\s+/g, ' ');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length < 3) return null;
  return t;
}

/** Shortens at a comma or a word boundary, never mid-word. */
export function clipTopic(t: string, max = 80): string {
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const comma = head.lastIndexOf(', ');
  const cut = comma > max * 0.5 ? comma : head.lastIndexOf(' ');
  return `${head.slice(0, cut > 0 ? cut : max).replace(/[\s,;:&–—-]+$/, '')}…`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Topic phrase of an appearance title, without the guest's name ("Mark Zuckerberg: Future of AI…" -> "Future of AI…"). */
export function topicPhrase(title: string, name: string): string {
  let t = title.replace(/^#?\d+\.?\s*[–-]?\s*/, '').replace(/\(.*?\)/g, ' ');
  t = t.replace(new RegExp(escapeRe(name), 'gi'), ' ');
  const parts = t
    .split(/\s*(?:\||:|\s[–-]\s)\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 12);
  const best = parts.sort((a, b) => b.length - a.length)[0] ?? '';
  return cleanTopic(best) ?? '';
}
