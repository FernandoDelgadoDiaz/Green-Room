// Language profile of a show, from its own episode history.
//
// What it measures: the language of each episode TITLE (a stopword count, deterministic, no model).
// The title language is a proxy for the language of the interview. It is not proof: a Spanish show
// can title an English interview in Spanish. So every number comes with its sample size and a
// confidence level, and the profile says "unknown" when the evidence is thin.

import type { Appearance, PodcastDataset } from './types';
import { nameKey } from './names';

export type Lang = 'es' | 'en';

const STOP: Record<Lang, Set<string>> = {
  es: new Set(
    'el la los las un una unos unas de del al que y o pero por para con sin sobre entre como más menos muy ya no sí es son fue era soy eres somos estar está están hay tiene tengo tener ser hacer hace me te se nos les lo le mi mis tu tus su sus este esta esto estos estas ese esa eso qué cómo cuándo dónde porque cuando donde todo todos nada vida mundo años historia cosas'.split(
      ' ',
    ),
  ),
  en: new Set(
    'the a an of and or but for with without about to in on at by from as is are was were be been being have has had do does did not no yes it its this that these those what how why when where who your you we our my me i they them their he she his her will can should would could all more most life world years story things'.split(
      ' ',
    ),
  ),
};

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[“”"«»'’()[\]|:;,.!?¿¡#\d–—-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * Language of one title, or null when the title has too few function words to tell (e.g. a bare
 * name such as "#69 - Juliana Gattas"). `strong` asks for a wider margin (used to override the
 * show-level language of a single appearance).
 */
export function detectTitleLanguage(title: string, strong = false): Lang | null {
  let es = 0;
  let en = 0;
  for (const w of words(title)) {
    if (STOP.es.has(w)) es++;
    if (STOP.en.has(w)) en++;
  }
  const min = strong ? 3 : 2;
  if (es >= min && es >= en * 2 + (strong ? 1 : 0)) return 'es';
  if (en >= min && en >= es * 2 + (strong ? 1 : 0)) return 'en';
  return null;
}

/** Language of an appearance: its own title when that is clear-cut, otherwise the show's declared language. */
export function appearanceLanguage(a: Pick<Appearance, 'title'>, showLanguage: string | undefined): string | null {
  return detectTitleLanguage(a.title, true) ?? (showLanguage ? baseLang(showLanguage) : null);
}

export const baseLang = (code: string) => code.toLowerCase().split(/[-_]/)[0];

export type Confidence = 'high' | 'medium' | 'low';

export interface LanguageProfile {
  /** Feed-declared language (the producer's own metadata). */
  declared: string;
  /** Episodes considered and how many titles had a detectable language. */
  episodes: number;
  detected: number;
  /** Detected titles per language, with their share of the detected ones. */
  shares: Array<{ lang: Lang; count: number; share: number }>;
  /** Languages the show interviews in, with enough evidence (≥ 15% of detected titles and ≥ 3 episodes). */
  accepted: string[];
  /** 'evidence': from the titles; 'declared': titles too thin, falling back to the feed's language; 'unknown'. */
  basis: 'evidence' | 'declared' | 'unknown';
  confidence: Confidence;
  /** Guests of this show who also have verified interviews on shows in another language or from another country. */
  internationalGuests: Array<{ name: string; evidence: string }>;
  internationalShare: number;
  /** One-line inferred editorial preference, in both languages. */
  preference: string;
  preferenceEs: string;
}

const LANG_NAME: Record<string, [string, string]> = { es: ['Spanish', 'español'], en: ['English', 'inglés'] };
const ln = (l: string, i: 0 | 1) => LANG_NAME[l]?.[i] ?? l;

/**
 * Builds the profile from episodes published before `asOf` (all of them by default).
 * `originOf` maps a show id to its VERIFIED origin country (unverified shows are absent), used to
 * spot guests with interviews on shows from another country.
 */
export function languageProfile(target: PodcastDataset, others: PodcastDataset[], opts: { asOf?: string; originOf?: Map<string, string> } = {}): LanguageProfile {
  const asOf = opts.asOf ?? '9999';
  const eps = target.episodes.filter((e) => !e.excluded && e.published && e.published < asOf);
  const counts: Record<Lang, number> = { es: 0, en: 0 };
  let detected = 0;
  for (const e of eps) {
    const l = detectTitleLanguage(e.title);
    if (l) (counts[l]++, detected++);
  }
  const shares = (Object.keys(counts) as Lang[])
    .map((lang) => ({ lang, count: counts[lang], share: detected ? counts[lang] / detected : 0 }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
  const declared = baseLang(target.language || '');
  let basis: LanguageProfile['basis'];
  let accepted: string[];
  if (detected >= 10) {
    basis = 'evidence';
    accepted = shares.filter((s) => s.share >= 0.15 && s.count >= 3).map((s) => s.lang);
  } else if (declared) {
    basis = 'declared';
    accepted = [declared];
  } else {
    basis = 'unknown';
    accepted = [];
  }
  const confidence: Confidence = basis !== 'evidence' ? 'low' : detected >= 50 ? 'high' : detected >= 20 ? 'medium' : 'low';

  // International guests: past guests whose other verified interviews are on shows in another
  // language, or on shows whose verified origin is a different country.
  const targetOrigin = opts.originOf?.get(target.id);
  const guestNames = new Map<string, string>();
  for (const e of eps) for (const g of e.guests) guestNames.set(nameKey(g.name), g.name);
  const elsewhere = new Map<string, string>();
  for (const o of others) {
    const oLang = baseLang(o.language || '');
    const oOrigin = opts.originOf?.get(o.id);
    const crossLang = oLang && declared && oLang !== declared;
    const crossCountry = targetOrigin && oOrigin && oOrigin !== targetOrigin;
    if (!crossLang && !crossCountry) continue;
    for (const e of o.episodes)
      for (const g of e.guests) {
        const key = nameKey(g.name);
        if (guestNames.has(key) && !elsewhere.has(key)) elsewhere.set(key, `${o.name}${crossLang ? ` (${oLang})` : ''}${crossCountry ? ` [${oOrigin!.toUpperCase()}]` : ''}`);
      }
  }
  const internationalGuests = [...elsewhere].map(([key, evidence]) => ({ name: guestNames.get(key)!, evidence }));
  const internationalShare = guestNames.size ? internationalGuests.length / guestNames.size : 0;

  let preference: string;
  let preferenceEs: string;
  if (basis === 'unknown') {
    preference = 'Interview language unknown: no detectable titles and no declared language.';
    preferenceEs = 'Idioma de las entrevistas desconocido: títulos sin idioma detectable y sin idioma declarado.';
  } else if (basis === 'declared') {
    preference = `Too few titles with a detectable language (${detected}); using the feed's declared language (${ln(declared, 0)}), low confidence.`;
    preferenceEs = `Muy pocos títulos con idioma detectable (${detected}); uso el idioma declarado en el RSS (${ln(declared, 1)}), confianza baja.`;
  } else {
    const main = shares[0];
    const rest = shares.slice(1);
    const pct = (x: number) => Math.round(x * 100);
    preference = `Interviews mostly in ${ln(main.lang, 0)} (${pct(main.share)}% of ${detected} titles)${rest.length ? `; ${rest.map((r) => `${ln(r.lang, 0)} ${pct(r.share)}%`).join(', ')}${accepted.length > 1 ? ' — also accepted' : ' — too rare to count as a habitual language'}` : ''}.`;
    preferenceEs = `Entrevistas mayormente en ${ln(main.lang, 1)} (${pct(main.share)}% de ${detected} títulos)${rest.length ? `; ${rest.map((r) => `${ln(r.lang, 1)} ${pct(r.share)}%`).join(', ')}${accepted.length > 1 ? ' — también aceptado' : ' — demasiado poco para considerarlo un idioma habitual'}` : ''}.`;
  }
  return { declared, episodes: eps.length, detected, shares, accepted, basis, confidence, internationalGuests, internationalShare, preference, preferenceEs };
}
