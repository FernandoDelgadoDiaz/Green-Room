// Request handler shared by the Netlify Function and the Vite dev server.
// Runs server-side, so QLOO_API_KEY never reaches the browser.

import lex from '../data/podcasts/lex-fridman.json';
import doac from '../data/podcasts/diary-of-a-ceo.json';
import creativo from '../data/podcasts/creativo.json';
import type { PodcastDataset } from './types';
import { runAgent } from './agent/agent';
import { runBacktest } from './backtest';
import { LiveQlooAdapter } from './qloo/client';
import { MockQlooAdapter } from './qloo/mock';
import type { QlooAdapter } from './qloo/types';

export const DATASETS: PodcastDataset[] = [lex, doac, creativo] as PodcastDataset[];

export interface Env {
  QLOO_API_KEY?: string;
  QLOO_BASE_URL?: string;
}

export function makeQloo(env: Env): QlooAdapter {
  return env.QLOO_API_KEY ? new LiveQlooAdapter({ apiKey: env.QLOO_API_KEY, baseUrl: env.QLOO_BASE_URL }) : new MockQlooAdapter();
}

export type ApiRequest =
  | { action: 'shows' }
  | { action: 'recommend'; showId: string; k?: number }
  | { action: 'backtest'; showId: string; cutoff: string; horizonMonths?: number };

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
    return { status: 200, body: { ...result, ranked: undefined } };
  }
  if (req.action === 'backtest') {
    if (!/^\d{4}-\d{2}-\d{2}/.test(req.cutoff)) return { status: 400, body: { error: 'cutoff must be YYYY-MM-DD' } };
    const qloo = makeQloo(env);
    const result = await runBacktest({
      target,
      others,
      cutoff: new Date(req.cutoff).toISOString(),
      horizonMonths: req.horizonMonths,
      qlooArm: { label: qloo.mode === 'LIVE' ? 'With Qloo (live API)' : 'With Qloo (MOCK — pipeline test only)', adapter: qloo },
    });
    return { status: 200, body: result };
  }
  return { status: 400, body: { error: 'Unknown action' } };
}
