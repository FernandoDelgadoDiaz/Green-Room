// Themes of a person known only from Wikidata/Wikipedia, built from short, structured statements
// (description + occupations), the closest equivalent of an interview title. The Wikipedia summary is
// NOT used for themes: it is long and mixes in proper names ("Center for the Study of Extraterrestrial
// Intelligence" read as AI), which made external candidates incomparable with title-based ones.

import { emptyVector, themesOfTitle, type ThemeId, type ThemeVector } from '../themes';
import type { ExternalCheck } from './external';

/** Occupation label (English, Wikidata) → theme. Only unambiguous professions; anything else adds nothing. */
const OCCUPATION_THEME: Array<[RegExp, ThemeId]> = [
  [/\b(business ?(man|woman|person)|entrepreneur|executive|financier|investor|banker|economist|chief executive)\b/i, 'business'],
  [/\b(politician|president|senator|diplomat|lawyer|attorney|jurist|pundit|political|civil servant|army officer|military officer|statesman)\b/i, 'history-politics'],
  [/\b(computer scientist|programmer|software|artificial intelligence|engineer|internet)\b/i, 'ai-tech'],
  [/\b(physicist|biologist|astronomer|chemist|mathematician|astrophysicist|geneticist)\b/i, 'science'],
  [/\b(physician|surgeon|nutritionist|neuroscientist|dietitian)\b/i, 'health'],
  [/\b(psychologist|psychiatrist|psychotherapist|therapist)\b/i, 'psychology'],
  [/\b(philosopher|theologian|priest|monk|rabbi|imam)\b/i, 'philosophy'],
  [/\b(athlete|basketball player|baseball player|football(er| player)|boxer|fighter|chess player|coach|swimmer|racing driver)\b/i, 'sports'],
  [/\b(actor|actress|singer|musician|comedian|composer|rapper|film director|television presenter|songwriter|screenwriter)\b/i, 'entertainment'],
];

export function occupationTheme(label: string): ThemeId | null {
  return OCCUPATION_THEME.find(([re]) => re.test(label))?.[1] ?? null;
}

/**
 * Themes from the Wikidata DESCRIPTION, which states why the person is notable ("American ufologist",
 * "American businessman"). The occupation list is unordered and includes past or minor roles (a
 * "retired physician" who is notable as a ufologist), so it is used only when there is no description.
 */
export function externalThemes(ch: Pick<ExternalCheck, 'name' | 'description' | 'occupations'>): { vector: ThemeVector; matched: Map<ThemeId, Set<string>>; basis: 'description' | 'occupations' | 'none' } {
  const desc = ch.description.en ?? ch.description.es ?? '';
  const sources = desc ? [desc] : ch.occupations.map((o) => o.en);
  const out = emptyVector();
  const matched = new Map<ThemeId, Set<string>>();
  const add = (id: ThemeId, word: string) => {
    out[id] += 1;
    if (!matched.has(id)) matched.set(id, new Set());
    matched.get(id)!.add(word);
  };
  for (const text of sources) {
    const lex = themesOfTitle(text, [ch.name]);
    for (const [id, words] of lex.matched) for (const w of words) add(id, w);
    for (const [re, id] of OCCUPATION_THEME) {
      const m = re.exec(text);
      if (m) add(id, m[0].toLowerCase());
    }
  }
  return { vector: out, matched, basis: desc ? 'description' : ch.occupations.length ? 'occupations' : 'none' };
}
