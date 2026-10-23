// Request handler shared by the Netlify Function and the Vite dev server.
// Runs server-side, so QLOO_API_KEY never reaches the browser.

import lex from '../data/podcasts/lex-fridman.json';
import doac from '../data/podcasts/diary-of-a-ceo.json';
import creativo from '../data/podcasts/creativo.json';
import profilesJson from '../data/profiles.json';
import type { PodcastDataset } from './types';
import { runAgent } from './agent/agent';
import { runBacktest } from './backtest';
import { LiveQlooAdapter } from './qloo/client';
import { MockQlooAdapter } from './qloo/mock';
import type { QlooAdapter } from './qloo/types';
import { resolveProfiles, type GuestProfile } from './profiles';
import { nameKey } from './names';

export const DATASETS: PodcastDataset[] = [lex, doac, creativo] as PodcastDataset[];

export interface Env {
  QLOO_API_KEY?: string;
  QLOO_BASE_URL?: string;
  /** Set to "0" to skip live Wikipedia lookups (tests, offline environments). */
  PROFILE_LOOKUP?: string;
}

export function makeQloo(env: Env): QlooAdapter {
  return env.QLOO_API_KEY ? new LiveQlooAdapter({ apiKey: env.QLOO_API_KEY, baseUrl: env.QLOO_BASE_URL }) : new MockQlooAdapter();
}

export type ApiRequest =
  | { action: 'shows' }
  | { action: 'recommend'; showId: string; k?: number }
  | { action: 'backtest'; showId: string; cutoff: string; horizonMonths?: number };

const STATIC_PROFILES = profilesJson as unknown as Record<string, GuestProfile>;
const runtimeProfiles = new Map<string, GuestProfile | null>();

/** Wikipedia/Wikidata lookup for people not in data/profiles.json. Best effort: any failure → null (initials avatar). */
async function liveProfiles(people: Array<{ name: string; appearanceTitles: string[] }>): Promise<void> {
  const todo = people.filter((p) => !runtimeProfiles.has(nameKey(p.name)));
  if (!todo.length) return;
  const fetchJson = async (url: string) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'GreenRoom/0.1 (Qloo hackathon demo)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const found = await resolveProfiles(todo, fetchJson, new Date().toISOString().slice(0, 10));
    for (const [name, prof] of found) runtimeProfiles.set(nameKey(name), prof);
  } catch {
    for (const p of todo) runtimeProfiles.set(nameKey(p.name), null);
  }
}

export async function profilesFor(recs: Array<{ key: string; name: string; appearances: Array<{ title: string }> }>, live: boolean): Promise<Record<string, GuestProfile | null>> {
  const missing = recs.filter((r) => !STATIC_PROFILES[r.key]);
  if (live && missing.length) await liveProfiles(missing.map((r) => ({ name: r.name, appearanceTitles: r.appearances.map((a) => a.title) })));
  return Object.fromEntries(recs.map((r) => [r.key, STATIC_PROFILES[r.key] ?? runtimeProfiles.get(r.key) ?? null]));
}

export function showSummaries() {
  return DATASETS.map((d) => {
    const eps = d.episodes.filter((e) => !e.excluded);
    const dates = eps.map((e) => e.published).filter(Boolean).sort();
    return {
      id: d.id,
      name: d.name,
      host: d.host,
      language: d.language,
      description: d.description,
      source: d.source,
      episodeCount: eps.length,
      withGuests: eps.filter((e) => e.guests.length > 0).length,
      firstEpisode: dates[0] ?? null,
      lastEpisode: dates[dates.length - 1] ?? null,
      recent: eps.slice(0, 6).map((e) => ({ title: e.title, published: e.published, url: e.url, guests: e.guests.map((g) => g.name) })),
    };
  });
}

export async function handleApi(req: ApiRequest, env: Env): Promise<{ status: number; body: unknown }> {
  if (req.action === 'shows') return { status: 200, body: { qlooMode: env.QLOO_API_KEY ? 'LIVE' : 'MOCK', shows: showSummaries() } };
  const target = DATASETS.find((d) => d.id === req.showId);
  if (!target) return { status: 404, body: { error: `Unknown show ${req.showId}` } };
  const others = DATASETS.filter((d) => d.id !== target.id);
  if (req.action === 'recommend') {
    const result = await runAgent({ target, others, qloo: makeQloo(env), k: Math.min(Math.max(req.k ?? 5, 1), 10) });
    const profiles = await profilesFor(result.recommendations, env.PROFILE_LOOKUP !== '0');
    return { status: 200, body: { ...result, ranked: undefined, profiles } };
  }
  if (req.action === 'backtest') {
    if (!/^\d{4}-\d{2}-\d{2}/.test(req.cutoff)) return { status: 400, body: { error: 'cutoff must be YYYY-MM-DD' } };
    const qloo = makeQloo(env);
    const result = await runBacktest({
      target,
      others,
      cutoff: new Date(req.cutoff).toISOString(),
      horizonMonths: req.horizonMonths,
      qlooArm: {
        label: qloo.mode === 'LIVE' ? 'With Qloo (live API)' : 'With Qloo (MOCK — pipeline test only)',
        labelEs: qloo.mode === 'LIVE' ? 'Con Qloo (API real)' : 'Con Qloo (MOCK — solo prueba del circuito)',
        adapter: qloo,
      },
    });
    return { status: 200, body: result };
  }
  return { status: 400, body: { error: 'Unknown action' } };
}
