// Snapshots the episode list of catalog shows that live on Spotify without a public RSS feed (shows
// with a `spotifyId` in data/catalog/sources.json), through the official Spotify Web API
// (client-credentials flow). Writes data/raw/catalog/<id>.spotify.json (gitignored), which
// scripts/build-catalog.ts turns into a dataset exactly like an RSS snapshot.
//
//   SPOTIFY_CLIENT_ID=… SPOTIFY_CLIENT_SECRET=… npx tsx scripts/fetch-spotify.ts
//
// Runs in the GitHub Actions workflow "Build catalog from Spotify"; the credentials are repository
// secrets and are never printed.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const id = process.env.SPOTIFY_CLIENT_ID;
const secret = process.env.SPOTIFY_CLIENT_SECRET;
if (!id || !secret) {
  console.error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set.');
  process.exit(1);
}

const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
  method: 'POST',
  headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
});
if (!tokenRes.ok) {
  console.error(`Spotify token request failed: HTTP ${tokenRes.status}`);
  process.exit(1);
}
const { access_token: token } = (await tokenRes.json()) as { access_token: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) {
      await sleep((Number(res.headers.get('retry-after')) || 2) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`Spotify ${path.split('?')[0]}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }
  throw new Error(`Spotify ${path.split('?')[0]}: rate limited`);
}

interface SpotifyEpisode {
  id: string;
  name: string;
  release_date: string;
  release_date_precision: string;
  external_urls: { spotify: string };
  language?: string;
  languages?: string[];
}

const src = JSON.parse(readFileSync('data/catalog/sources.json', 'utf8')) as { shows: Array<{ id: string; spotifyId?: string; spotifyMarket?: string }> };
mkdirSync('data/raw/catalog', { recursive: true });
const MAX_EPISODES = 500;

for (const s of src.shows.filter((x) => x.spotifyId)) {
  const market = s.spotifyMarket ?? 'AR';
  try {
    const show = await api<{ name: string; publisher: string; description: string; languages: string[]; total_episodes: number; external_urls: { spotify: string }; images: Array<{ url: string }> }>(`/shows/${s.spotifyId}?market=${market}`);
    const episodes: SpotifyEpisode[] = [];
    for (let offset = 0; offset < Math.min(show.total_episodes, MAX_EPISODES); offset += 50) {
      const page = await api<{ items: Array<SpotifyEpisode | null>; next: string | null }>(`/shows/${s.spotifyId}/episodes?market=${market}&limit=50&offset=${offset}`);
      episodes.push(...page.items.filter((e): e is SpotifyEpisode => Boolean(e)));
      if (!page.next) break;
    }
    writeFileSync(
      `data/raw/catalog/${s.id}.spotify.json`,
      JSON.stringify({
        retrievedAt: new Date().toISOString(),
        show: { name: show.name, publisher: show.publisher, description: show.description, languages: show.languages, total: show.total_episodes, url: show.external_urls.spotify, artwork: show.images[0]?.url ?? null },
        episodes: episodes.map((e) => ({ id: e.id, title: e.name, published: e.release_date_precision === 'day' ? `${e.release_date}T12:00:00.000Z` : null, url: e.external_urls.spotify, language: e.language ?? e.languages?.[0] ?? null })),
      }),
    );
    console.log(`${s.id.padEnd(24)} ${episodes.length} episodes (of ${show.total_episodes})`);
  } catch (e) {
    console.error(`${s.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
