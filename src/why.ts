// "Why we recommend them", written from each person's own evidence: who they are (Wikidata), who the
// show already had of the same kind, where they were interviewed and on what. Two cards only read
// alike when the evidence is alike.

import type { Recommendation } from '../core/agent/agent';
import { CATEGORY_LABELS, categoriesOf } from '../core/people';

type Lang = 'en' | 'es';

export function countryName(code: string, lang: Lang): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

const list = (xs: string[], lang: Lang) => new Intl.ListFormat(lang, { type: 'conjunction' }).format(xs);
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** "Journalist · Argentina": occupation and citizenship from Wikidata, or null without a record. */
export function audienceSubtitle(rec: Recommendation, lang: Lang): string | null {
  const a = rec.audience;
  if (!a) return null;
  // The occupation that makes them the right kind of guest for this show, when there is one.
  const fitting = a.sharedCategories.length ? a.occupations.find((o) => categoriesOf([o.en]).includes(a.sharedCategories[0])) : undefined;
  const occ = (fitting ?? a.occupations[0])?.[lang] ?? (a.categories[0] ? CATEGORY_LABELS[a.categories[0]][lang] : null);
  const where = a.countries[0] ? countryName(a.countries[0], lang) : null;
  return [occ && cap(occ), where].filter(Boolean).join(' · ') || null;
}

function occOf(a: NonNullable<Recommendation['audience']>, lang: Lang): string | null {
  const o = a.occupations.find((x) => categoriesOf([x.en]).includes(a.sharedCategories[0])) ?? a.occupations[0];
  return o ? o[lang] : null;
}

/** Up to three sentences, each one only when its evidence exists. */
export function whySentences(rec: Recommendation, showName: string, lang: Lang): string[] {
  const es = lang === 'es';
  const a = rec.audience;
  const out: string[] = [];
  const latest = rec.appearances[0];
  const themes = rec.sharedThemes.map((s) => (es ? s.labelEs : s.label));

  // 1. Same kind of guest as people the show already had.
  if (a?.sharedCategories.length && a.similarPastGuests.length) {
    const kind = CATEGORY_LABELS[a.sharedCategories[0]];
    out.push(
      es
        ? `${showName} ya recibió a ${kind.esPlural} como ${list(a.similarPastGuests, lang)}; ${rec.name} tiene ese mismo perfil${occOf(a, 'es') ? ` (${occOf(a, 'es')})` : ''}.`
        : `${showName} has already hosted ${kind.enPlural} such as ${list(a.similarPastGuests, lang)}; ${rec.name} has that same profile${occOf(a, 'en') ? ` (${occOf(a, 'en')})` : ''}.`,
    );
  } else if (themes.length) {
    out.push(es ? `Sus entrevistas tocan ${list(themes, lang)}, temas frecuentes en ${showName}.` : `Their interviews cover ${list(themes, lang)}, frequent topics on ${showName}.`);
  }

  // 2. Known by this audience: same country (and where they were interviewed), or widely known.
  if (a?.sameCountry && a.matchedCountry && a.matchedCountry !== a.showCountry) {
    const country = countryName(a.matchedCountry, lang);
    out.push(es ? `Es una figura de ${country}, de donde viene buena parte de los invitados de ${showName}.` : `A public figure from ${country}, where many of ${showName}’s guests come from.`);
  } else if (a?.sameCountry && a.showCountry) {
    const country = countryName(a.showCountry, lang);
    out.push(
      a.sameCountryShows.length
        ? es
          ? `Es una figura de ${country} con entrevistas en ${list(a.sameCountryShows, lang)}: su público ya la conoce.`
          : `A public figure from ${country}, already interviewed on ${list(a.sameCountryShows, lang)}: this audience knows them.`
        : es
          ? `Es una figura de ${country}, el mismo público de ${showName}.`
          : `A public figure from ${country}, the same audience as ${showName}.`,
    );
  } else if (a && a.wikipedias >= 25) {
    out.push(es ? `Es una figura de alcance internacional: tiene artículo en ${a.wikipedias} ediciones de Wikipedia.` : `Known internationally: covered in ${a.wikipedias} Wikipedia editions.`);
  } else if (a?.sameCountryShows.length) {
    out.push(es ? `Ya tuvo entrevistas en ${list(a.sameCountryShows, lang)}, del mismo país que ${showName}.` : `Already interviewed on ${list(a.sameCountryShows, lang)}, from the same country as ${showName}.`);
  }

  // 3. The concrete interview: what it was about, where and when.
  if (latest) {
    const topic = rec.conversationTopics[0];
    out.push(
      topic
        ? es
          ? `Su entrevista más reciente, en ${latest.showName} (${latest.published.slice(0, 10)}), fue sobre “${clip(topic)}”.`
          : `Most recent interview, on ${latest.showName} (${latest.published.slice(0, 10)}): “${clip(topic)}”.`
        : es
          ? `Su entrevista más reciente fue en ${latest.showName} (${latest.published.slice(0, 10)}).`
          : `Most recently interviewed on ${latest.showName} (${latest.published.slice(0, 10)}).`,
    );
  }
  if (!out.length) out.push(es ? 'Tiene trayectoria verificable como entrevistado en podcasts comparables.' : 'They have a verifiable interview track record on comparable podcasts.');
  return out;
}
