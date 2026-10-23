// Serves the recorded Wikidata/Wikipedia responses by URL, like the real APIs.
import search from './search.json';
import entities from './entities.json';
import labels from './labels.json';
import summaries from './summaries.json';
import { nameKey } from '../../../core/names';

export function fixtureFetch(log: string[] = []) {
  return async (url: string): Promise<unknown> => {
    log.push(url);
    const u = new URL(url);
    if (u.hostname === 'www.wikidata.org') {
      const action = u.searchParams.get('action');
      if (action === 'wbsearchentities') {
        const q = u.searchParams.get('search')!;
        const hit = Object.entries(search.search).find(([k]) => nameKey(k) === nameKey(q));
        return { search: hit ? hit[1] : [] };
      }
      const ids = u.searchParams.get('ids')!.split('|');
      const src = (u.searchParams.get('props') === 'labels' ? labels.entities : entities.entities) as Record<string, unknown>;
      return { entities: Object.fromEntries(ids.map((id) => [id, src[id] ?? { id, missing: '' }])) };
    }
    const m = /^(en|es)\.wikipedia\.org$/.exec(u.hostname);
    if (m) {
      const title = decodeURIComponent(u.pathname.split('/').pop()!).replace(/_/g, ' ');
      const page = (summaries.pages as Record<string, unknown>)[`${m[1]}:${title}`];
      if (!page) throw new Error('404');
      return page;
    }
    throw new Error(`unexpected host ${u.hostname}`);
  };
}

