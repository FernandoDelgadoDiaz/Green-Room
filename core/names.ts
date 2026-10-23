// Name normalization used to detect repeat guests and cross-show appearances.

const HONORIFICS = new Set(['dr', 'prof', 'professor', 'sir', 'dame', 'president', 'mr', 'mrs', 'ms', 'lord']);

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Canonical key: lowercase, no accents, no punctuation, no honorifics. */
export function nameKey(name: string): string {
  const tokens = stripAccents(name)
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/['-]/g, '')
    .split(/\s+/)
    .filter((t) => t && !HONORIFICS.has(t));
  return tokens.join(' ');
}

/** Two names refer to the same person if their canonical keys match exactly. We do not use
 *  fuzzy matching beyond this: a false merge would fabricate a past appearance. */
export function sameName(a: string, b: string): boolean {
  const ka = nameKey(a);
  return ka.length > 0 && ka === nameKey(b);
}

/** "JAVIER PANIAGUA" -> "Javier Paniagua"; leaves mixed-case names untouched. */
export function titleCaseIfShouting(name: string): string {
  const letters = name.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (!letters || letters !== letters.toUpperCase()) return name.trim();
  return name
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w) => (w.trim() && w !== '-' ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join('')
    .trim();
}

const NAME_TOKEN = /^(?:[A-ZÀ-Ý][\p{L}'’.-]*|[A-Z]{2,}|de|del|la|van|von|der|da|di|y|al|el)$/u;

/** Heuristic: 1–5 tokens, each capitalized (or a common particle), no digits. */
export function looksLikePersonName(s: string, opts: { minTokens?: number } = {}): boolean {
  const t = s.trim();
  if (!t || t.length > 60 || /\d/.test(t)) return false;
  const tokens = t.split(/\s+/);
  if (tokens.length < (opts.minTokens ?? 2) || tokens.length > 5) return false;
  if (!/^[A-ZÀ-Ý]/u.test(tokens[0])) return false;
  return tokens.every((tok) => NAME_TOKEN.test(tok));
}

const SEGMENT_WORDS = new Set(['tertulia', 'mesa', 'debate', 'especial', 'expediente', 'roundtable', 'panel', 'podcast', 'show', 'club', 'mailbag', 'tren', 'recap', 'resumen']);

/** "El Tren", "Tertulia de Sapiens": recurring segment or series names that title rules can mistake for people. */
export function looksLikeSegmentName(name: string): boolean {
  const toks = stripAccents(name).toLowerCase().split(/\s+/);
  return ['el', 'la', 'los', 'las', 'the', 'lo'].includes(toks[0]) || toks.some((t) => SEGMENT_WORDS.has(t));
}
