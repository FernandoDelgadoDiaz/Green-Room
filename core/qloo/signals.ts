// Building Qloo queries from what a show is documented to talk about.
// Words that are too broad to describe an audience (e.g. "music", "TV") are not sent as tags just
// because a tag with that name exists; Spanish theme words are paired with their English form so
// Spanish-language shows can reach Qloo's (mostly English) tag names.

import { nameKey, stripAccents } from '../names';

/**
 * Comparison key for tag and title names: case, accents, spaces and punctuation removed, so
 * "Stand Up Comedy", "stand-up comedy" and "Stand-Up Comedy" are the same tag name.
 */
export const compactKey = (s: string) => stripAccents(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Too general to characterize an audience: never used alone as a tag signal. */
export const GENERIC_WORDS = new Set(
  'music musica musico musicos tv film films movie movies cine pelicula peliculas life vida love amor family familia money dinero health salud sport sports deporte comedy comedia youtube redes fama fame power poder exito success people gente world mundo tech news life time'.split(' '),
);

/** Spanish (accent-free) → English form of specific theme words. */
const EN: Record<string, string> = {
  ia: 'artificial intelligence',
  inteligencia: 'artificial intelligence',
  artificial: 'artificial intelligence',
  ai: 'artificial intelligence',
  intelligence: 'artificial intelligence',
  hijos: 'parenting',
  mundial: 'world cup',
  millonarios: 'wealth',
  capitalismo: 'capitalism',
  tecnologia: 'technology',
  datos: 'data science',
  ciencia: 'science',
  universo: 'universe',
  espacio: 'outer space',
  fisica: 'physics',
  matematicas: 'mathematics',
  ovnis: 'ufo',
  negocios: 'business',
  negocio: 'business',
  emprender: 'entrepreneurship',
  empresa: 'entrepreneurship',
  economia: 'economics',
  invertir: 'investing',
  politica: 'politics',
  guerra: 'war',
  democracia: 'democracy',
  historia: 'history',
  filosofia: 'philosophy',
  espiritualidad: 'spirituality',
  ansiedad: 'anxiety',
  depresion: 'depression',
  mente: 'mind',
  emociones: 'emotions',
  terapia: 'therapy',
  ajedrez: 'chess',
  futbol: 'football',
  box: 'boxing',
  comediantes: 'stand-up comedy',
  canciones: 'songwriting',
  freestyle: 'freestyle rap',
  rap: 'hip hop',
  crypto: 'cryptocurrency',
  bitcoin: 'bitcoin',
  startups: 'startups',
  dieta: 'diet',
  ejercicio: 'exercise',
  relaciones: 'relationships',
  pareja: 'relationships',
};

export interface TagQuery {
  /** Theme word from the show's titles. */
  word: string;
  /** What is sent to Qloo (English form when one exists). */
  query: string;
  /** Tag names accepted as an exact match (the word or its English form), as compact keys. */
  accepts: string[];
}

export function buildTagQueries(themes: Array<{ words: string[] }>, max = 6): { queries: TagQuery[]; skippedGeneric: string[] } {
  const queries: TagQuery[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const t of themes.slice(0, 3)) {
    let perTheme = 0;
    for (const w of t.words) {
      if (perTheme >= 3) break;
      const k = stripAccents(w).toLowerCase();
      if (GENERIC_WORDS.has(k)) {
        if (!skipped.includes(w)) skipped.push(w);
        continue;
      }
      const en = EN[k];
      const query = en ?? w;
      if (seen.has(nameKey(query))) continue;
      seen.add(nameKey(query));
      queries.push({ word: w, query, accepts: [...new Set([compactKey(w), compactKey(query)])] });
      perTheme++;
    }
  }
  return { queries: queries.slice(0, max), skippedGeneric: skipped };
}

/** Exact-title variants of a show name ("X – subtitle", "X Podcast", "X con Host"): never fuzzy. */
export function showNameVariants(name: string, host?: string): string[] {
  const v = new Set<string>([name.trim()]);
  const parts = name.split(/\s[–—-]\s|:\s|\s\|\s/).map((s) => s.trim());
  let main = parts[0];
  // "Host – Title" (e.g. "Santiago Bilinkis – Futuro en Construcción"): the title is the show's name.
  if (host && parts.length > 1 && parts[1].length > 2 && nameKey(parts[0]) === nameKey(host)) (v.add(parts[1]), v.add(host), (main = parts[1]));
  if (main.length > 2) v.add(main);
  const noPodcast = main.replace(/\b(el|the)?\s*podcast\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  if (noPodcast.length > 2) v.add(noPodcast);
  const noHost = main.replace(/\s+(con|with)\s+.+$/i, '').trim();
  if (noHost.length > 2) v.add(noHost);
  if (host && nameKey(main).includes(nameKey(host))) v.add(host);
  return [...v].slice(0, 3);
}
