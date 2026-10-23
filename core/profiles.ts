// Guest profiles (photo, short description) from Wikipedia / Wikidata / Wikimedia Commons.
//
// Rules:
//   - Only free-licensed images (pageimages pilicense=free), with author + license shown as credit.
//   - A Wikipedia page is accepted only if it is not a disambiguation page AND its text shares at least
//     one meaningful word with the person's own appearance titles. This guards against attaching the
//     photo of a namesake. When in doubt, no profile: the UI shows initials instead.
//   - Wikidata descriptions are CC0; Wikipedia extracts are CC BY-SA and are shown as quotes with a link.

import { stripAccents } from './names';

export interface GuestPhoto {
  thumbUrl: string;
  width: number;
  height: number;
  filePage: string;
  license: string;
  licenseUrl: string | null;
  artist: string;
}

export interface GuestProfile {
  name: string;
  wikipedia: { title: string; url: string };
  wikidataId: string | null;
  description: { en: string | null; es: string | null };
  extract: { en: string | null; es: string | null; esUrl: string | null };
  photo: GuestPhoto | null;
  /** Words shared between the Wikipedia text and the person's appearance titles (identity check). */
  matchEvidence: string[];
  retrievedAt: string;
}

export type JsonFetcher = (url: string) => Promise<unknown>;

const STOP = new Set(
  'the and for with from that this what your you are was were have has had about into over under their them they how why who when where will would could should most more less than then also just like only very much many some such been being does did done make made made take took life world people story stories real truth future past year years time times part best biggest great new old one two three dont cant wont its it\'s his her him she he our out not but all any can may'.split(' '),
);

export function contentWords(text: string): Set<string> {
  return new Set(
    stripAccents(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
}

/**
 * Spanish → English forms of common occupation and context words, so an English Qloo description
 * ("Mexican singer") can be compared with Spanish interview titles ("cantante mexicano"). Applied to
 * both sides before stemming; it only widens what counts as the SAME word, never adds new evidence.
 */
const CANON: Record<string, string> = {
  musico: 'musician', musica: 'music', cantante: 'singer', cantautor: 'songwriter', compositor: 'composer', compositora: 'composer', rapero: 'rapper', banda: 'band',
  actor: 'actor', actriz: 'actress', comediante: 'comedian', humorista: 'comedian', director: 'director', directora: 'director', guionista: 'screenwriter', cineasta: 'filmmaker', productor: 'producer',
  escritor: 'writer', escritora: 'writer', autor: 'author', autora: 'author', poeta: 'poet', periodista: 'journalist', conductor: 'presenter', conductora: 'presenter', presentador: 'presenter', locutor: 'broadcaster',
  empresario: 'businessman', empresaria: 'businesswoman', emprendedor: 'entrepreneur', emprendedora: 'entrepreneur', inversor: 'investor', economista: 'economist',
  politico: 'politician', politica: 'politician', diputado: 'politician', senador: 'senator', presidente: 'president', abogado: 'lawyer', abogada: 'lawyer',
  cientifico: 'scientist', cientifica: 'scientist', fisico: 'physicist', medico: 'physician', psicologo: 'psychologist', psicologa: 'psychologist', filosofo: 'philosopher', historiador: 'historian', divulgador: 'science communicator',
  futbolista: 'footballer', boxeador: 'boxer', piloto: 'driver', atleta: 'athlete', entrenador: 'coach', deportista: 'athlete', ajedrecista: 'chess',
  youtuber: 'youtuber', influencer: 'influencer', streamer: 'streamer', chef: 'chef', cocinero: 'chef',
  mexicano: 'mexican', mexicana: 'mexican', argentino: 'argentine', argentina: 'argentine', espanol: 'spanish', espanola: 'spanish', colombiano: 'colombian', chileno: 'chilean', estadounidense: 'american',
  tecnologia: 'technology', inteligencia: 'intelligence', ciencia: 'science', negocios: 'business', historia: 'history', politica_: 'politics', television: 'television', pelicula: 'film', cine: 'film',
};
const canon = (w: string) => CANON[w] ?? w;

/** Light stemming: words match when they share their first 6 letters ("neuroscience" ~ "neuroscientist"). */
const stem = (w: string) => canon(w).slice(0, 6);

/** Words in common between the Wikipedia text and the appearance titles, excluding the person's own name. */
export function contextOverlap(name: string, wikiText: string, appearanceTitles: string[]): string[] {
  const nameStems = new Set([...contentWords(name)].map(stem));
  const titleStems = new Set<string>();
  for (const t of appearanceTitles) for (const w of contentWords(t)) if (!nameStems.has(stem(w))) titleStems.add(stem(w));
  return [...contentWords(wikiText)].filter((w) => titleStems.has(stem(w)) && !nameStems.has(stem(w)));
}

/** First sentences of an extract, for display. */
export function firstSentences(text: string | null, n = 2): string | null {
  if (!text) return null;
  const parts = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  return parts.slice(0, n).join('').trim();
}

export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------ URL builders (batchable)
const WIKI_API = (lang: 'en' | 'es') => `https://${lang}.wikipedia.org/w/api.php`;

export function pagesUrl(lang: 'en' | 'es', titles: string[]): string {
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    redirects: '1',
    titles: titles.join('|'),
    prop: 'pageprops|extracts|pageimages|langlinks|info|description',
    inprop: 'url',
    ppprop: 'disambiguation|wikibase_item',
    exintro: '1',
    explaintext: '1',
    exlimit: '20',
    piprop: 'name',
    pilicense: 'free',
    pilimit: '20',
    lllang: 'es',
    lllimit: '20',
  });
  return `${WIKI_API(lang)}?${p.toString()}`;
}

export function linksUrl(titles: string[]): string {
  const p = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', titles: titles.join('|'), prop: 'links', plnamespace: '0', pllimit: 'max' });
  return `${WIKI_API('en')}?${p.toString()}`;
}

export function wikidataUrl(ids: string[]): string {
  const p = new URLSearchParams({ action: 'wbgetentities', format: 'json', ids: ids.join('|'), props: 'descriptions', languages: 'en|es' });
  return `https://www.wikidata.org/w/api.php?${p.toString()}`;
}

export function imageInfoUrl(files: string[]): string {
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    titles: files.map((f) => `File:${f}`).join('|'),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '320',
  });
  return `${WIKI_API('en')}?${p.toString()}`;
}

export function esExtractsUrl(titles: string[]): string {
  const p = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', redirects: '1', titles: titles.join('|'), prop: 'extracts|info', inprop: 'url', exintro: '1', explaintext: '1', exsentences: '2', exlimit: '20' });
  return `${WIKI_API('es')}?${p.toString()}`;
}

// ------------------------------------------------------------------ resolution
interface WikiPage {
  title: string;
  missing?: boolean;
  invalid?: boolean;
  fullurl?: string;
  extract?: string;
  description?: string;
  pageimage?: string;
  pageprops?: { disambiguation?: string; wikibase_item?: string };
  langlinks?: Array<{ lang: string; title: string }>;
  links?: Array<{ title: string }>;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Maps each requested title through normalization/redirects to the final page title. */
function resolveTitles(body: Record<string, unknown>): Map<string, string> {
  const q = (body.query ?? {}) as Record<string, unknown>;
  const map = new Map<string, string>();
  for (const step of [...((q.normalized as Array<{ from: string; to: string }>) ?? []), ...((q.redirects as Array<{ from: string; to: string }>) ?? [])]) {
    map.set(step.from, step.to);
  }
  return map;
}

function follow(title: string, map: Map<string, string>): string {
  let t = title;
  for (let i = 0; i < 5 && map.has(t); i++) t = map.get(t)!;
  return t;
}

export async function resolveProfiles(
  people: Array<{ name: string; appearanceTitles: string[] }>,
  fetchJson: JsonFetcher,
  retrievedAt: string,
): Promise<Map<string, GuestProfile | null>> {
  const result = new Map<string, GuestProfile | null>();
  const accepted: Array<{ name: string; page: WikiPage; overlap: string[] }> = [];

  const disambiguations: Array<{ person: { name: string; appearanceTitles: string[] }; title: string }> = [];
  for (const batch of chunk(people, 20)) {
    const body = (await fetchJson(pagesUrl('en', batch.map((p) => p.name)))) as Record<string, unknown>;
    const titleMap = resolveTitles(body);
    const pages = (((body.query as Record<string, unknown>)?.pages as WikiPage[]) ?? []).filter(Boolean);
    for (const person of batch) {
      const final = follow(person.name, titleMap);
      const page = pages.find((p) => p.title === final);
      if (page && page.pageprops?.disambiguation !== undefined) disambiguations.push({ person, title: page.title });
      if (!page || page.missing || page.invalid || page.pageprops?.disambiguation !== undefined) {
        result.set(person.name, null);
        continue;
      }
      const overlap = contextOverlap(person.name, `${page.title} ${page.description ?? ''} ${page.extract ?? ''}`, person.appearanceTitles);
      if (overlap.length === 0) {
        result.set(person.name, null);
        continue;
      }
      accepted.push({ name: person.name, page, overlap });
    }
  }

  // Disambiguation pages: consider only the options listed there whose title starts with the person's
  // name ("Scott Galloway (professor)"), and accept one only if exactly one option matches the context.
  const options = new Map<string, string[]>();
  for (const batch of chunk(disambiguations, 20)) {
    const body = (await fetchJson(linksUrl(batch.map((d) => d.title)))) as { query?: { pages?: WikiPage[] } };
    for (const d of batch) {
      const page = body.query?.pages?.find((p) => p.title === d.title);
      const prefix = `${d.title} (`;
      options.set(d.person.name, (page?.links ?? []).map((l) => l.title).filter((t) => t.startsWith(prefix)).slice(0, 12));
    }
  }
  const optionTitles = [...new Set([...options.values()].flat())];
  const optionPages = new Map<string, WikiPage>();
  for (const batch of chunk(optionTitles, 20)) {
    const body = (await fetchJson(pagesUrl('en', batch))) as Record<string, unknown>;
    for (const p of (((body.query as Record<string, unknown>)?.pages as WikiPage[]) ?? [])) if (p && !p.missing) optionPages.set(p.title, p);
  }
  for (const d of disambiguations) {
    const matches = (options.get(d.person.name) ?? [])
      .map((t) => optionPages.get(t))
      .filter((p): p is WikiPage => Boolean(p) && p!.pageprops?.disambiguation === undefined)
      .map((page) => ({ page, overlap: contextOverlap(d.person.name, `${page.title} ${page.description ?? ''} ${page.extract ?? ''}`, d.person.appearanceTitles) }))
      .filter((m) => m.overlap.length > 0);
    if (matches.length === 1) {
      accepted.push({ name: d.person.name, page: matches[0].page, overlap: matches[0].overlap });
      result.delete(d.person.name);
    }
  }

  const ids = accepted.map((a) => a.page.pageprops?.wikibase_item).filter((x): x is string => Boolean(x));
  const descriptions = new Map<string, { en: string | null; es: string | null }>();
  for (const batch of chunk(ids, 50)) {
    const body = (await fetchJson(wikidataUrl(batch))) as { entities?: Record<string, { descriptions?: Record<string, { value: string }> }> };
    for (const [id, e] of Object.entries(body.entities ?? {})) {
      descriptions.set(id, { en: e.descriptions?.en?.value ?? null, es: e.descriptions?.es?.value ?? null });
    }
  }

  const files = [...new Set(accepted.map((a) => a.page.pageimage).filter((x): x is string => Boolean(x)))];
  const photos = new Map<string, GuestPhoto>();
  for (const batch of chunk(files, 25)) {
    const body = (await fetchJson(imageInfoUrl(batch))) as { query?: { pages?: Array<{ title: string; imageinfo?: Array<Record<string, unknown>> }>; normalized?: Array<{ from: string; to: string }> } };
    for (const p of body.query?.pages ?? []) {
      const info = p.imageinfo?.[0];
      if (!info) continue;
      const meta = (info.extmetadata ?? {}) as Record<string, { value?: string }>;
      const license = stripHtml(meta.LicenseShortName?.value ?? '');
      // Keep only images whose license metadata is present and free (pilicense=free already filters).
      if (!license || /fair use|non-free/i.test(license)) continue;
      photos.set(p.title.replace(/^File:/, '').replace(/ /g, '_'), {
        thumbUrl: String(info.thumburl ?? info.url),
        width: Number(info.thumbwidth ?? 0),
        height: Number(info.thumbheight ?? 0),
        filePage: String(info.descriptionurl ?? ''),
        license,
        licenseUrl: meta.LicenseUrl?.value ?? null,
        artist: stripHtml(meta.Artist?.value ?? 'Unknown author'),
      });
    }
  }

  const esTitles = accepted.map((a) => a.page.langlinks?.find((l) => l.lang === 'es')?.title).filter((x): x is string => Boolean(x));
  const esExtracts = new Map<string, { extract: string; url: string }>();
  for (const batch of chunk(esTitles, 20)) {
    const body = (await fetchJson(esExtractsUrl(batch))) as { query?: { pages?: WikiPage[] } };
    for (const p of body.query?.pages ?? []) if (p.extract) esExtracts.set(p.title, { extract: p.extract, url: p.fullurl ?? '' });
  }

  for (const a of accepted) {
    const qid = a.page.pageprops?.wikibase_item ?? null;
    const esTitle = a.page.langlinks?.find((l) => l.lang === 'es')?.title;
    const es = esTitle ? esExtracts.get(esTitle) : undefined;
    result.set(a.name, {
      name: a.name,
      wikipedia: { title: a.page.title, url: a.page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(a.page.title.replace(/ /g, '_'))}` },
      wikidataId: qid,
      description: { en: (qid && descriptions.get(qid)?.en) || a.page.description || null, es: (qid && descriptions.get(qid)?.es) || null },
      extract: { en: firstSentences(a.page.extract ?? null), es: firstSentences(es?.extract ?? null), esUrl: es?.url ?? null },
      photo: a.page.pageimage ? (photos.get(a.page.pageimage.replace(/ /g, '_')) ?? null) : null,
      matchEvidence: a.overlap.slice(0, 6),
      retrievedAt,
    });
  }
  return result;
}
