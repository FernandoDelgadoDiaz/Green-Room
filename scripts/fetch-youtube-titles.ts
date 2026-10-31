// Lists every video title on each show's official YouTube channel (data/catalog/youtube-channels.json)
// into data/catalog/youtube-titles.json, with yt-dlp's flat playlist mode (titles only, nothing
// downloaded). Runs in the "Build catalog data" workflow, where YouTube is reachable. The titles reach
// back to a show's first years, which its RSS feed often does not: they are used only so that a past
// guest named in a title is never proposed again.
//
//   npx tsx scripts/fetch-youtube-titles.ts   (needs yt-dlp on PATH)

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const channels = JSON.parse(readFileSync('data/catalog/youtube-channels.json', 'utf8')) as Record<string, string>;
const path = 'data/catalog/youtube-titles.json';
const out = JSON.parse(readFileSync(path, 'utf8')) as { _note: string; shows: Record<string, { channel: string; retrievedAt: string; titles: string[] }> };
for (const [id, url] of Object.entries(channels)) {
  try {
    const text = execFileSync('yt-dlp', ['--flat-playlist', '--ignore-errors', '--print', '%(title)s', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000 });
    const titles = [...new Set(text.split('\n').map((t) => t.trim()).filter((t) => t && t !== 'NA'))];
    if (titles.length < 50) throw new Error(`only ${titles.length} titles`);
    out.shows[id] = { channel: url, retrievedAt: new Date().toISOString().slice(0, 10), titles };
    console.log(`${id.padEnd(24)} ${titles.length} titles`);
  } catch (e) {
    // Keep what an earlier run stored: a failed listing never empties the record.
    console.error(`${id}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
}
writeFileSync(path, JSON.stringify(out) + '\n');
