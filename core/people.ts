// Who the guests ARE: occupation, citizenship, how widely known, and a free photo, from Wikidata (CC0)
// and Wikimedia Commons. Built offline for every guest in the catalog (scripts/build-people.ts) and
// read at runtime, so a show can be profiled by the kind of people it interviews, not only by the
// words in its episode titles (many shows title episodes with the guest's name alone).
//
// Identity rule, as everywhere else: a name match is never enough. A same-name Wikidata person is
// accepted only with context: a citizenship matching the country of a show they were interviewed on,
// or words shared between their documented occupations/description and their interview titles.

import { contextOverlap } from './profiles';
import { nameKey } from './names';

export type OccupationCategory =
  | 'politics'
  | 'music'
  | 'acting'
  | 'film'
  | 'comedy'
  | 'media'
  | 'journalism'
  | 'writing'
  | 'sports'
  | 'business'
  | 'economics'
  | 'science'
  | 'technology'
  | 'health'
  | 'psychology'
  | 'thought'
  | 'food'
  | 'military'
  | 'arts'
  | 'religion';

export const CATEGORY_LABELS: Record<OccupationCategory, { en: string; es: string; enPlural: string; esPlural: string }> = {
  politics: { en: 'politician', es: 'político/a', enPlural: 'politicians', esPlural: 'políticos' },
  music: { en: 'musician', es: 'músico/a', enPlural: 'musicians', esPlural: 'músicos' },
  acting: { en: 'actor', es: 'actor/actriz', enPlural: 'actors', esPlural: 'actores' },
  film: { en: 'filmmaker', es: 'cineasta', enPlural: 'filmmakers', esPlural: 'cineastas' },
  comedy: { en: 'comedian', es: 'humorista', enPlural: 'comedians', esPlural: 'humoristas' },
  media: { en: 'TV/online personality', es: 'figura de TV o redes', enPlural: 'TV and online personalities', esPlural: 'figuras de TV y redes' },
  journalism: { en: 'journalist', es: 'periodista', enPlural: 'journalists', esPlural: 'periodistas' },
  writing: { en: 'writer', es: 'escritor/a', enPlural: 'writers', esPlural: 'escritores' },
  sports: { en: 'athlete', es: 'deportista', enPlural: 'athletes', esPlural: 'deportistas' },
  business: { en: 'businessperson', es: 'empresario/a', enPlural: 'business people', esPlural: 'empresarios' },
  economics: { en: 'economist', es: 'economista', enPlural: 'economists', esPlural: 'economistas' },
  science: { en: 'scientist', es: 'científico/a', enPlural: 'scientists', esPlural: 'científicos' },
  technology: { en: 'technologist', es: 'tecnólogo/a', enPlural: 'technologists', esPlural: 'tecnólogos' },
  health: { en: 'physician', es: 'médico/a', enPlural: 'doctors and health experts', esPlural: 'médicos y expertos en salud' },
  psychology: { en: 'psychologist', es: 'psicólogo/a', enPlural: 'psychologists', esPlural: 'psicólogos' },
  thought: { en: 'academic', es: 'académico/a', enPlural: 'academics and thinkers', esPlural: 'académicos y pensadores' },
  food: { en: 'chef', es: 'chef', enPlural: 'chefs', esPlural: 'chefs' },
  military: { en: 'military/security veteran', es: 'militar o experto en seguridad', enPlural: 'military and security veterans', esPlural: 'militares y expertos en seguridad' },
  arts: { en: 'artist', es: 'artista', enPlural: 'artists and designers', esPlural: 'artistas y diseñadores' },
  religion: { en: 'religious figure', es: 'religioso/a', enPlural: 'religious figures', esPlural: 'religiosos' },
};

// Matched against the English label of each Wikidata occupation (P106). Order matters only for
// readability: a person may fall in several categories.
const CATEGORY_RULES: Array<[OccupationCategory, RegExp]> = [
  ['politics', /\b(politician|diplomat|minister|legislator|mayor|governor|senator|member of (the )?(parliament|congress|chamber)|deputy|president|political|statesperson|civil servant|trade unionist)\b/],
  ['music', /\b(singer|musician|rapper|composer|songwriter|guitarist|drummer|pianist|bassist|disc jockey|dj|record producer|music producer|vocalist|violinist|bandleader|conductor|cantautor)\b/],
  ['acting', /\b(actor|actress|voice actor|stage actor|film actor|television actor)\b/],
  ['film', /\b(film director|screenwriter|film producer|television producer|television director|filmmaker|cinematographer|film critic|showrunner)\b/],
  ['comedy', /\b(comedian|humorist|stand-up|comic|impressionist)\b/],
  ['media', /\b(television presenter|presenter|radio personality|radio presenter|broadcaster|youtuber|influencer|streamer|podcaster|internet celebrity|vlogger|blogger|model|television personality|media personality|internet personality|content creator|socialite)\b/],
  ['journalism', /\b(journalist|reporter|columnist|editor|news anchor|correspondent|sports commentator|commentator)\b/],
  ['writing', /\b(writer|novelist|poet|author|essayist|playwright|biographer)\b/],
  ['sports', /\b(footballer|football manager|football coach|football pundit|association football|athlete|boxer|tennis|basketball|racing driver|racecar|mixed martial|martial artist|coach|cyclist|swimmer|rugby|baseball|american football|golfer|wrestler|runner|marathon|climber|mountaineer|skier|surfer|chess|sport|formula one|polo|volleyball|handball|motorcycle racer|fighter|olympic)\b/],
  ['business', /\b(businessperson|businessman|businesswoman|entrepreneur|executive|investor|banker|chief executive|founder|(?<!football |soccer |team )manager|venture capitalist|marketer|real estate)\b/],
  ['economics', /\b(economist|financial analyst|trader)\b/],
  ['science', /\b(scientist|physicist|biologist|neuroscientist|astronomer|astrophysicist|mathematician|chemist|geneticist|cosmologist|astronaut|researcher|anthropologist|paleontologist|archaeologist)\b/],
  ['technology', /\b(engineer|computer scientist|programmer|software|inventor|technologist|game designer|developer)\b/],
  ['health', /\b(physician|surgeon|medical doctor|nutritionist|dietitian|neurologist|cardiologist|psychiatrist|nurse|pharmacologist|endocrinologist|epidemiologist|personal trainer|fitness)\b/],
  ['psychology', /\b(psychologist|psychotherapist|psychoanalyst|therapist|life coach|coach \(|motivational speaker|self-help)\b/],
  ['thought', /\b(philosopher|historian|sociologist|academic|professor|university teacher|political scientist|theologian|linguist|lawyer|jurist|judge)\b/],
  ['food', /\b(chef|cook|restaurateur|sommelier)\b/],
  ['military', /\b(military|soldier|army officer|navy seal|special forces|police officer|intelligence officer|spy|marine|military officer|sniper|veteran)\b/],
  ['arts', /\b(painter|artist|designer|photographer|architect|sculptor|illustrator|cartoonist|fashion designer|tattoo artist|magician|mentalist)\b/],
  ['religion', /\b(priest|monk|rabbi|imam|pastor|bishop|nun|spiritual teacher|guru|religious)\b/],
];

export function categoriesOf(occupationLabelsEn: string[]): OccupationCategory[] {
  const out = new Set<OccupationCategory>();
  for (const raw of occupationLabelsEn) {
    const l = raw.toLowerCase();
    for (const [cat, re] of CATEGORY_RULES) if (re.test(l)) out.add(cat);
  }
  return [...out];
}

/**
 * The single thing a description leads with ("English sports broadcaster and former footballer" →
 * media): the earliest known kind of guest named in it. Null when it names none.
 */
export function mainCategory(description: string | null | undefined): OccupationCategory | null {
  const d = (description ?? '').toLowerCase();
  let best: { cat: OccupationCategory; at: number } | null = null;
  for (const [cat, re] of CATEGORY_RULES) {
    const m = re.exec(d);
    if (m && (!best || m.index < best.at)) best = { cat, at: m.index };
  }
  return best?.cat ?? null;
}

export interface PersonPhoto {
  thumbUrl: string;
  filePage: string;
  license: string;
  licenseUrl: string | null;
  artist: string;
}

export interface PersonRecord {
  qid: string;
  label: string;
  description: { en: string | null; es: string | null };
  /** Up to 4 documented occupations (Wikidata P106), with labels. */
  occupations: Array<{ en: string; es: string }>;
  categories: OccupationCategory[];
  /** ISO 3166-1 alpha-2 codes of citizenship (P27), lowercase. */
  countries: string[];
  /** Number of Wikipedia editions with an article: how widely documented the person is. */
  wikipedias: number;
  /** Date of death (Wikidata P570, YYYY-MM-DD), or null: nobody deceased is ever recommended. */
  died?: string | null;
  /** Wikipedia editions among the ones that matter here. */
  articles: string[];
  photo: PersonPhoto | null;
  /** Why this Wikidata item is this guest: 'country' and/or 'context' (shared words). */
  match: string[];
  matchEvidence: string[];
}

export interface PeopleData {
  generatedAt: string;
  source: string;
  people: Record<string, PersonRecord>;
}

// ------------------------------------------------------------------ offline resolution

export type JsonFetch = (url: string) => Promise<unknown>;

interface WdEntity {
  id: string;
  missing?: string;
  descriptions?: Record<string, { value: string }>;
  labels?: Record<string, { value: string }>;
  aliases?: Record<string, Array<{ value: string }>>;
  sitelinks?: Record<string, { title: string }>;
  claims?: Record<string, Array<{ mainsnak: { datavalue?: { value: unknown } } }>>;
}

const WD = 'https://www.wikidata.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const KEPT_ARTICLES = new Set(['eswiki', 'enwiki', 'ptwiki', 'frwiki', 'itwiki', 'dewiki']);

const claimIds = (e: WdEntity, p: string) =>
  (e.claims?.[p] ?? []).map((c) => c.mainsnak.datavalue?.value).map((v) => (v && typeof v === 'object' ? (v as { id?: string }).id : undefined)).filter((x): x is string => Boolean(x));
const deathDate = (e: WdEntity): string | null => {
  const v = e.claims?.P570?.[0]?.mainsnak.datavalue?.value as { time?: string } | undefined;
  return v?.time ? v.time.replace(/^\+/, '').slice(0, 10) : null;
};
const claimStrings = (e: WdEntity, p: string) => (e.claims?.[p] ?? []).map((c) => c.mainsnak.datavalue?.value).filter((v): v is string => typeof v === 'string');
const wikipediaCount = (e: WdEntity) => Object.keys(e.sitelinks ?? {}).filter((s) => /^[a-z_]+wiki$/.test(s) && !['commonswiki', 'specieswiki', 'metawiki', 'mediawikiwiki', 'wikidatawiki', 'sourceswiki'].includes(s)).length;
const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export interface GuestToResolve {
  name: string;
  appearanceTitles: string[];
  /** Origin countries (iso2) of the shows they were interviewed on. */
  showCountries: string[];
  /** Languages of those shows; the first is searched first. */
  languages: string[];
  /** Date of their earliest interview (YYYY-MM-DD): nobody who died before it can be this guest. */
  firstInterview?: string;
}

export interface ResolveStats {
  searched: number;
  resolved: number;
  ambiguous: number;
  noContext: number;
  notFound: number;
}

/**
 * Resolves guests to Wikidata people. `fetchJson` does all network access (cached and rate-limited by
 * the caller). Returns a record per resolved guest, keyed by nameKey.
 */
export async function resolvePeople(
  guests: GuestToResolve[],
  fetchJson: JsonFetch,
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ people: Record<string, PersonRecord>; stats: ResolveStats }> {
  const stats: ResolveStats = { searched: 0, resolved: 0, ambiguous: 0, noContext: 0, notFound: 0 };
  const concurrency = opts.concurrency ?? 4;

  // 1. Same-name search, in the language of the shows first.
  const idsByGuest = new Map<string, string[]>();
  let next = 0;
  let done = 0;
  const search = async (g: GuestToResolve) => {
    const ids = new Set<string>();
    const langs = [...new Set([...g.languages, 'en', 'es'])];
    for (const lang of langs) {
      const url = `${WD}?action=wbsearchentities&format=json&type=item&limit=10&language=${lang}&uselang=${lang}&search=${encodeURIComponent(g.name)}`;
      const res = (await fetchJson(url).catch(() => null)) as { search?: Array<{ id: string; label?: string; match?: { text?: string }; description?: string }> } | null;
      for (const s of res?.search ?? []) {
        if (/disambiguation page|página de desambiguación/i.test(s.description ?? '')) continue;
        if (nameKey(s.label ?? '') === nameKey(g.name) || nameKey(s.match?.text ?? '') === nameKey(g.name)) ids.add(s.id);
      }
      if (ids.size) break;
    }
    idsByGuest.set(g.name, [...ids]);
    stats.searched++;
    opts.onProgress?.(++done, guests.length);
  };
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < guests.length) await search(guests[next++]);
    }),
  );

  // 2. Entities of every same-name item.
  const allIds = [...new Set([...idsByGuest.values()].flat())];
  const entities = new Map<string, WdEntity>();
  for (const batch of chunk(allIds, 50)) {
    const url = `${WD}?action=wbgetentities&format=json&props=labels|aliases|descriptions|claims|sitelinks&languages=en|es&ids=${batch.join('|')}`;
    const res = (await fetchJson(url).catch(() => null)) as { entities?: Record<string, WdEntity> } | null;
    for (const [id, e] of Object.entries(res?.entities ?? {})) if (!e.missing) entities.set(id, e);
  }
  const humans = new Set([...entities.values()].filter((e) => claimIds(e, 'P31').includes('Q5')).map((e) => e.id));

  // 3. Labels of occupations and ISO codes of countries.
  const occIds = [...new Set([...humans].flatMap((id) => claimIds(entities.get(id)!, 'P106')))];
  const countryIds = [...new Set([...humans].flatMap((id) => claimIds(entities.get(id)!, 'P27')))];
  const occLabels = new Map<string, { en: string; es: string }>();
  for (const batch of chunk(occIds, 50)) {
    const res = (await fetchJson(`${WD}?action=wbgetentities&format=json&props=labels&languages=en|es&ids=${batch.join('|')}`).catch(() => null)) as { entities?: Record<string, WdEntity> } | null;
    for (const [id, e] of Object.entries(res?.entities ?? {})) {
      const en = e.labels?.en?.value ?? e.labels?.es?.value;
      if (en) occLabels.set(id, { en, es: e.labels?.es?.value ?? en });
    }
  }
  const iso = new Map<string, string>();
  for (const batch of chunk(countryIds, 50)) {
    const res = (await fetchJson(`${WD}?action=wbgetentities&format=json&props=claims&ids=${batch.join('|')}`).catch(() => null)) as { entities?: Record<string, WdEntity> } | null;
    for (const [id, e] of Object.entries(res?.entities ?? {})) {
      const code = claimStrings(e, 'P297')[0];
      if (code) iso.set(id, code.toLowerCase());
    }
  }

  // 4. Choose the person for each guest, with context.
  const chosen = new Map<string, { e: WdEntity; match: string[]; evidence: string[] }>();
  for (const g of guests) {
    // A namesake who died before the guest's first interview cannot be the guest.
    const cands = (idsByGuest.get(g.name) ?? [])
      .filter((id) => humans.has(id))
      .map((id) => entities.get(id)!)
      .filter((e) => !(g.firstInterview && deathDate(e) && deathDate(e)! < g.firstInterview));
    if (!cands.length) {
      stats.notFound++;
      continue;
    }
    const scored = cands.map((e) => {
      const countries = claimIds(e, 'P27').map((q) => iso.get(q)).filter((x): x is string => Boolean(x));
      const occ = claimIds(e, 'P106').map((q) => occLabels.get(q)).filter((x): x is { en: string; es: string } => Boolean(x));
      const text = [e.descriptions?.en?.value, e.descriptions?.es?.value, ...occ.flatMap((o) => [o.en, o.es])].filter(Boolean).join(' ');
      const overlap = contextOverlap(g.name, text, g.appearanceTitles);
      const sameCountry = countries.filter((c) => g.showCountries.includes(c));
      const match: string[] = [];
      const evidence: string[] = [];
      if (sameCountry.length) (match.push('country'), evidence.push(`citizenship ${sameCountry.join('/').toUpperCase()} = show country`));
      if (overlap.length) (match.push('context'), evidence.push(`shared words: ${overlap.slice(0, 4).join(', ')}`));
      return { e, match, evidence, both: sameCountry.length > 0 && overlap.length > 0 };
    });
    const withContext = scored.filter((s) => s.match.length > 0);
    const pick = withContext.length === 1 ? withContext[0] : withContext.filter((s) => s.both).length === 1 ? withContext.find((s) => s.both)! : null;
    if (pick) chosen.set(g.name, pick);
    else if (withContext.length > 1) stats.ambiguous++;
    else stats.noContext++;
  }

  // 5. Free photos (P18, Wikimedia Commons), with author and license for the credit.
  const files = [...new Set([...chosen.values()].map((c) => claimStrings(c.e, 'P18')[0]).filter(Boolean))];
  const photos = new Map<string, PersonPhoto>();
  for (const batch of chunk(files, 40)) {
    const url = `${COMMONS}?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=320&titles=${batch.map((f) => encodeURIComponent(`File:${f}`)).join('|')}`;
    const res = (await fetchJson(url).catch(() => null)) as { query?: { pages?: Array<{ title: string; imageinfo?: Array<Record<string, unknown>> }>; normalized?: Array<{ from: string; to: string }> } } | null;
    const back = new Map((res?.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of res?.query?.pages ?? []) {
      const info = p.imageinfo?.[0];
      if (!info) continue;
      const meta = (info.extmetadata ?? {}) as Record<string, { value?: string }>;
      const license = stripHtml(meta.LicenseShortName?.value ?? '');
      if (!license || /fair use|non-free/i.test(license)) continue;
      const original = (back.get(p.title) ?? p.title).replace(/^File:/, '');
      photos.set(original.replace(/_/g, ' '), {
        thumbUrl: String(info.thumburl ?? info.url),
        filePage: String(info.descriptionurl ?? ''),
        license,
        licenseUrl: meta.LicenseUrl?.value ?? null,
        artist: stripHtml(meta.Artist?.value ?? 'Unknown author').slice(0, 120),
      });
    }
  }

  const people: Record<string, PersonRecord> = {};
  for (const [name, { e, match, evidence }] of chosen) {
    const occ = claimIds(e, 'P106').map((q) => occLabels.get(q)).filter((x): x is { en: string; es: string } => Boolean(x));
    const file = claimStrings(e, 'P18')[0];
    people[nameKey(name)] = {
      qid: e.id,
      label: e.labels?.es?.value ?? e.labels?.en?.value ?? name,
      description: { en: e.descriptions?.en?.value ?? null, es: e.descriptions?.es?.value ?? null },
      occupations: occ.slice(0, 4),
      categories: categoriesOf(occ.map((o) => o.en)),
      countries: [...new Set(claimIds(e, 'P27').map((q) => iso.get(q)).filter((x): x is string => Boolean(x)))],
      wikipedias: wikipediaCount(e),
      died: deathDate(e),
      articles: Object.keys(e.sitelinks ?? {}).filter((s) => KEPT_ARTICLES.has(s)),
      photo: file ? (photos.get(file.replace(/_/g, ' ')) ?? null) : null,
      match,
      matchEvidence: evidence,
    };
    stats.resolved++;
  }
  return { people, stats };
}
