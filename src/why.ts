// "Why we recommend them", written from each person's own evidence: who they are (Wikidata), who the
// show already had of the same kind, where they were interviewed and on what. Two cards only read
// alike when the evidence is alike.

import type { Recommendation } from '../core/agent/agent';
import { CATEGORY_LABELS, categoriesOf, type OccupationCategory } from '../core/people';
import { clipTopic, topicPhrase } from '../core/topic';

type Lang = 'en' | 'es';

export function countryName(code: string, lang: Lang): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** Country name inside an English sentence: "from the United States", "from the United Kingdom". */
const inSentence = (code: string, lang: Lang) => (lang === 'en' && /^(us|gb|nl|ae|ph|cz|do)$/i.test(code) ? `the ${countryName(code, lang)}` : countryName(code, lang));
/** "de Argentina", "del Reino Unido". */
const deCountry = (code: string) => (code.toLowerCase() === 'gb' ? 'del Reino Unido' : `de ${countryName(code, 'es')}`);

const list = (xs: string[], lang: Lang) => new Intl.ListFormat(lang, { type: 'conjunction' }).format(xs);
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "January 2026" / "enero de 2026": a date as a person would say it. */
export function monthYear(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/** Nationality words in an English Wikidata description, for the countries Green Room covers. */
const DEMONYMS: Record<string, RegExp> = {
  us: /\bAmerican\b/,
  gb: /\b(British|English|Scottish|Welsh|Northern Irish)\b/,
  ar: /\bArgentin/,
  mx: /\bMexican\b/,
  es: /\b(Spanish|Catalan|Basque|Galician)\b/,
};

const OTHER_DEMONYMS = /\b(Venezuelan|Colombian|Chilean|Peruvian|Uruguayan|Paraguayan|Bolivian|Ecuadorian|Cuban|Dominican|Puerto Rican|Canadian|Australian|New Zealand|Irish|French|German|Italian|Portuguese|Dutch|Belgian|Swiss|Austrian|Swedish|Norwegian|Danish|Finnish|Polish|Russian|Ukrainian|Israeli|Lebanese|Iranian|Turkish|Indian|Pakistani|Chinese|Japanese|Korean|Brazilian|Nigerian|South African|Egyptian)\b/;

/** The description names a nationality, and not the one claimed (Michael Douglas: "American actor"; Boris Izaguirre: Venezuelan). */
function contradicts(description: string | null | undefined, code: string): boolean {
  if (!description || !DEMONYMS[code]) return false;
  if (DEMONYMS[code].test(description)) return false;
  return Object.values(DEMONYMS).some((re) => re.test(description)) || OTHER_DEMONYMS.test(description);
}

/**
 * "Cantante argentina", "American businessman": the person's own one-line Wikidata description in the
 * reader's language (gender and main occupation already right), or occupation · country without one.
 */
export function audienceSubtitle(rec: Recommendation, lang: Lang): string | null {
  const a = rec.audience;
  if (!a) return null;
  const d = a.description?.[lang]?.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (d && d.length >= 4) return cap(shortDescription(d));
  const occ = fittingOccupation(a).occ?.[lang] ?? (a.categories[0] ? CATEGORY_LABELS[a.categories[0]][lang] : null);
  // Dual citizens show the country that ties them to this audience (Musk: United States, not South Africa).
  const tie = a.sameCountry ? (a.matchedCountry ?? a.showCountry) : null;
  const code = tie && a.countries.includes(tie) ? tie : a.countries[0];
  const where = code ? countryName(code, lang) : null;
  return [occ && cap(occ), where].filter(Boolean).join(' · ') || null;
}

/** Long descriptions ("Músico, compositor, pianista, director de cine y cantante…") end at a list boundary. */
function shortDescription(d: string, max = 52): string {
  d = d.split(/(?<![A-Z])\.\s+(?=[A-ZÁÉÍÓÚÑ])/)[0];
  if (d.length <= max) return d;
  const head = d.slice(0, max);
  const cut = Math.max(head.lastIndexOf(', '), head.lastIndexOf(' y '), head.lastIndexOf(' e '), head.lastIndexOf(' and '));
  return cut > 12 ? head.slice(0, cut).replace(/[,;:\s]+$/, '') : `${head.slice(0, head.lastIndexOf(' ')).replace(/[,;:\s]+$/, '')}…`;
}

/** The person's main occupation that the show shares (Wikidata order), and its category. */
function fittingOccupation(a: NonNullable<Recommendation['audience']>): { occ: { en: string; es: string } | null; cat: OccupationCategory | null } {
  for (const o of a.occupations) {
    const cat = categoriesOf([o.en]).find((c) => a.sharedCategories.includes(c));
    if (cat) return { occ: o, cat };
  }
  return { occ: a.occupations[0] ?? null, cat: a.sharedCategories[0] ?? null };
}

/**
 * "Who they are": the opening of their Wikipedia article (reader's language only), what they do now
 * (positions held without an end date) and notable awards. Null parts when the record has none.
 */
export function whoTheyAre(rec: Recommendation, lang: Lang): { bio: string | null; position: string | null; awards: string | null } {
  const a = rec.audience;
  const es = lang === 'es';
  const bio = a?.bio?.[lang]?.replace(/\s*\([^)]*\)/g, '').replace(/\s+([,.;])/g, '$1').replace(/\s+/g, ' ').trim() || null;
  const pos = a?.positions?.[0];
  const position = pos ? `${cap(pos[lang])}${pos.since ? (es ? ` (desde ${pos.since})` : ` (since ${pos.since})`) : ''}` : null;
  const aw = (a?.awards ?? []).slice(0, 2).map((x) => `${x[lang]}${x.year ? ` (${x.year})` : ''}`);
  return { bio, position, awards: aw.length ? aw.join(es ? ' · ' : ' · ') : null };
}

const monthsAgo = (iso: string, now = Date.now()) => (now - Date.parse(iso)) / (30.44 * 24 * 3600 * 1000);

/**
 * Themes we can honestly say a guest's interviews cover: at least two different theme words in their
 * titles. One word is not enough ("autoestima" once does not make a singer a psychology guest).
 */
export function citableThemes(rec: Pick<Recommendation, 'sharedThemes'>): Recommendation['sharedThemes'] {
  return rec.sharedThemes.filter((s) => new Set(s.words).size >= 2);
}

/**
 * Up to three sentences, each one only when its evidence exists. `variant` (the card's position)
 * changes the wording, never the facts, so five cards in a row do not read like a template.
 */
export function whySentences(rec: Recommendation, showName: string, lang: Lang, variant = Math.max(0, (rec.rank ?? 1) - 1), opts: { kindClaims?: boolean } = {}): string[] {
  const es = lang === 'es';
  const v = variant % 3;
  const a = rec.audience;
  const out: string[] = [];
  const latest = rec.appearances[0];
  const themes = citableThemes(rec).map((s) => (es ? s.labelEs : s.label));

  // 1. Same kind of guest as people the show already had (by what each one is mainly known for).
  // The first shared kind with past guests to name (the one their description leads with comes first).
  // Results computed before card version 2 carry categories from every occupation ever listed: no claim.
  const cat = opts.kindClaims === false ? null : a?.sharedCategories.find((c) => (a.similarByCategory?.[c] ?? []).length) ?? null;
  const similar = cat ? a!.similarByCategory![cat]! : [];
  if (a && cat && similar.length) {
    const kind = CATEGORY_LABELS[cat];
    const names = list(similar, lang);
    const one = similar.length === 1;
    out.push(
      es
        ? [
            `${showName} ya recibió a ${kind.esPlural} como ${names}; ${rec.name} encaja en ese perfil.`,
            `${names} ya ${one ? 'pasó' : 'pasaron'} por ${showName}; ${rec.name} viene del mismo mundo.`,
            `Encaja con lo que busca ${showName}, que ya entrevistó a ${kind.esPlural} como ${names}.`,
          ][v]
        : [
            `${showName} has already hosted ${kind.enPlural} such as ${names}; ${rec.name} fits that profile.`,
            `${names} ${one ? 'has' : 'have'} already been on ${showName}; ${rec.name} comes from the same world.`,
            `A fit for ${showName}, which has already interviewed ${kind.enPlural} such as ${names}.`,
          ][v],
    );
  } else if (themes.length) {
    out.push(es ? `Sus entrevistas tocan ${list(themes, lang)}, temas frecuentes en ${showName}.` : `Their interviews cover ${list(themes, lang)}, frequent topics on ${showName}.`);
  }

  // 2. Known by this audience: where they were interviewed, or their country when it is an argument.
  const descEn = a?.description?.en;
  const claim = a?.sameCountry ? (a.matchedCountry ?? a.showCountry) : null;
  const claimOk = Boolean(claim) && !contradicts(descEn, claim!);
  if (a && claimOk && claim !== a.showCountry) {
    const country = inSentence(claim!, lang);
    out.push(es ? `Es una figura ${deCountry(claim!)}, de donde viene buena parte de los invitados del programa.` : `A public figure from ${country}, where many of the show’s guests come from.`);
  } else if (a && claimOk && a.sameCountryShows.length) {
    const shows = list(a.sameCountryShows, lang);
    const country = inSentence(claim!, lang);
    out.push(
      es
        ? [`Ya pasó por ${shows}, del mismo país que el programa.`, `También tiene entrevistas en ${shows}, ${deCountry(claim!)}.`, `Su paso por ${shows} le da visibilidad ante este público.`][v]
        : [`Already on ${shows}, from the same country.`, `Also interviewed on ${shows}, from ${country}.`, `Familiar to this audience from ${shows}.`][v],
    );
  } else if (a && claimOk) {
    const country = inSentence(claim!, lang);
    out.push(es ? `Es una figura ${deCountry(claim!)}, como el público del programa.` : `A public figure from ${country}, like the show’s audience.`);
  } else if (a && a.wikipedias >= 25) {
    out.push(es ? `Es una figura de alcance internacional: tiene artículo en ${a.wikipedias} ediciones de Wikipedia.` : `Known internationally: covered in ${a.wikipedias} Wikipedia editions.`);
  }

  // 3. The concrete interview: where, when, and what it was about (from that same interview's title).
  //    When the latest title names no topic, the most recent interview that does is added.
  if (latest) {
    const topicOf = (x: (typeof rec.appearances)[number]) => {
      const t = topicPhrase(x.title, rec.name);
      return t ? clipTopic(t) : null;
    };
    const topic = topicOf(latest);
    const when = monthYear(latest.published, lang);
    // Our sources are 24 shows, not everything they did: an old date is said to be ours, not theirs.
    const stale = monthsAgo(latest.published) > 12;
    const earlier = topic ? null : rec.appearances.slice(1).find((x) => topicOf(x));
    out.push(
      stale
        ? es
          ? `En los programas que analizamos, su entrevista más reciente es de ${when}, en ${latest.showName}${topic ? `: “${topic}”` : ''}.`
          : `Across the shows we analyze, their latest interview is from ${when}, on ${latest.showName}${topic ? `: “${topic}”` : ''}.`
        : topic
        ? es
          ? [`Su entrevista más reciente fue en ${latest.showName}, en ${when}: “${topic}”.`, `En ${when} habló en ${latest.showName} sobre “${topic}”.`, `Su última entrevista fue en ${when}, en ${latest.showName}: “${topic}”.`][v]
          : [`Most recently on ${latest.showName}, ${when}: “${topic}”.`, `Spoke on ${latest.showName} in ${when} about “${topic}”.`, `Latest interview: ${latest.showName}, ${when}: “${topic}”.`][v]
        : earlier
          ? es
            ? `Su entrevista más reciente fue en ${latest.showName}, en ${when}; antes habló ${earlier.showName === latest.showName ? 'en el mismo programa' : `en ${earlier.showName}`} sobre “${topicOf(earlier)}”.`
            : `Most recently on ${latest.showName}, ${when}; before that, ${earlier.showName === latest.showName ? 'on the same show' : `on ${earlier.showName}`}: “${topicOf(earlier)}”.`
          : es
            ? `Su entrevista más reciente fue en ${latest.showName}, en ${when}.`
            : `Most recently interviewed on ${latest.showName}, in ${when}.`,
    );
  }
  if (!out.length) out.push(es ? 'Tiene trayectoria verificable como entrevistado en podcasts comparables.' : 'They have a verifiable interview track record on comparable podcasts.');
  return out;
}
