import type { AgentResult } from '../core/agent/agent';
import type { BacktestResult } from '../core/backtest';
import type { PodcastSource } from '../core/types';
import type { GuestProfile } from '../core/profiles';

export type RecommendResult = AgentResult & { profiles: Record<string, GuestProfile | null> };

export interface ShowSummary {
  id: string;
  name: string;
  host: string;
  language: string;
  description: string;
  source: PodcastSource;
  episodeCount: number;
  withGuests: number;
  firstEpisode: string | null;
  lastEpisode: string | null;
  recent: Array<{ title: string; published: string; url: string | null; guests: string[] }>;
}

async function call<T>(body: unknown): Promise<T> {
  const res = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json as T;
}

export const api = {
  shows: () => call<{ qlooMode: 'LIVE' | 'MOCK'; shows: ShowSummary[] }>({ action: 'shows' }),
  recommend: (showId: string) => call<RecommendResult>({ action: 'recommend', showId, k: 5 }),
  backtest: (showId: string, cutoff: string) => call<BacktestResult>({ action: 'backtest', showId, cutoff, horizonMonths: 24 }),
};
