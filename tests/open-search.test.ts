import { describe, expect, it } from 'vitest';
import { assertSafeUrl, isPrivateAddress, safeFetch, UnsafeUrlError } from '../core/net/safe-fetch';
import { analyzeFeedXml, OpenPodcastSearch, type CatalogRef } from '../core/podcasts/open-search';
import { handlePodcasts } from '../core/podcasts-api';

const publicLookup = async () => ['93.184.216.34'];

describe('SSRF protection', () => {
  it('classifies private, reserved and mapped addresses', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3'])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('rejects unsafe URLs before any request', async () => {
    const bad = ['file:///etc/passwd', 'ftp://example.com/feed', 'https://localhost/feed', 'https://127.0.0.1/feed', 'https://[::1]/x', 'https://169.254.169.254/latest/meta-data', 'https://user:pw@example.com/feed', 'https://example.com:8443/feed', 'https://intranet/feed', 'https://printer.local/x', 'not a url'];
    for (const u of bad) await expect(assertSafeUrl(u, { lookup: publicLookup }), u).rejects.toBeInstanceOf(UnsafeUrlError);
    // A public-looking name that resolves to a private address (DNS-based SSRF).
    await expect(assertSafeUrl('https://evil.example.com/feed', { lookup: async () => ['10.0.0.5'] })).rejects.toMatchObject({ code: 'private' });
    // Allow-listed API hosts only, where required.
    await expect(assertSafeUrl('https://example.com/x', { lookup: publicLookup, allowHosts: ['itunes.apple.com'] })).rejects.toMatchObject({ code: 'not_allowed' });
    // http is upgraded to https, not refused.
    expect((await assertSafeUrl('http://feeds.example.com/rss', { lookup: publicLookup })).protocol).toBe('https:');
  });

  it('re-validates every redirect, and caps size and time', async () => {
    const redirectTo = (loc: string) => (async () => new Response(null, { status: 302, headers: { location: loc } })) as unknown as typeof fetch;
    await expect(safeFetch('https://ok.example.com/feed', { lookup: async (h) => (h === 'ok.example.com' ? ['93.184.216.34'] : ['127.0.0.1']), fetchImpl: redirectTo('https://inside.example.com/admin') })).rejects.toMatchObject({ code: 'private' });
    await expect(safeFetch('https://ok.example.com/feed', { lookup: publicLookup, fetchImpl: redirectTo('https://ok.example.com/feed') })).rejects.toMatchObject({ code: 'redirects' });
    const big = (async () => new Response('x'.repeat(5000))) as unknown as typeof fetch;
    await expect(safeFetch('https://ok.example.com/feed', { lookup: publicLookup, fetchImpl: big, maxBytes: 1000 })).rejects.toMatchObject({ code: 'too_large' });
    const slow = ((_u: string, init: { signal: AbortSignal }) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
    await expect(safeFetch('https://ok.example.com/feed', { lookup: publicLookup, fetchImpl: slow, timeoutMs: 30 })).rejects.toMatchObject({ code: 'timeout' });
    const ok = (async () => new Response('<rss></rss>', { headers: { 'content-type': 'application/rss+xml' } })) as unknown as typeof fetch;
    expect((await safeFetch('https://ok.example.com/feed', { lookup: publicLookup, fetchImpl: ok })).text).toBe('<rss></rss>');
  });
});

// ------------------------------------------------------------------ feeds
const rss = (items: Array<[string, string]>, lang = 'es') =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>Show de Prueba</title><language>${lang}</language><description>Entrevistas</description><itunes:author>Ana Conductora</itunes:author>${items
    .map(([t, d], i) => `<item><guid>g${i}</guid><title>${t}</title><pubDate>${new Date(d).toUTCString()}</pubDate><link>https://example.com/e${i}</link></item>`)
    .join('')}</channel></rss>`;
const NOW = new Date('2026-10-23T12:00:00Z');
const NAMES = ['Lucía Pérez', 'Martín Gómez', 'Sofía Díaz', 'Julián Torres', 'Valeria Ruiz', 'Diego Morales', 'Camila Rojas', 'Tomás Herrera', 'Paula Méndez', 'Nicolás Castro', 'Elena Vidal', 'Bruno Silva'];
const interviews = NAMES.map((n, i) => [`${n}: “La vida y la ciencia de los datos”`, `2026-0${(i % 9) + 1}-10T00:00:00Z`] as [string, string]);

describe('feed analysis states', () => {
  it('complete: dated interviews with guest names', () => {
    const a = analyzeFeedXml(rss(interviews), { feedUrl: 'https://x.example/rss', now: NOW });
    expect(a.level).toBe('complete');
    expect(a.dataset?.episodes.length).toBe(12);
    expect(a.stats.withGuestNames).toBeGreaterThanOrEqual(10);
  });

  it('limited: old feed, with the reason', () => {
    const old = interviews.map(([t]) => [t, '2023-03-01T00:00:00Z'] as [string, string]);
    const a = analyzeFeedXml(rss(old), { feedUrl: 'https://x.example/rss', now: NOW });
    expect(a.level).toBe('limited');
    expect(a.reasons[0].es).toMatch(/último año/);
  });

  it('insufficient: incomplete feeds or no guest names, never a guess', () => {
    expect(analyzeFeedXml(rss(interviews.slice(0, 3)), { feedUrl: 'https://x.example/rss', now: NOW })).toMatchObject({ level: 'insufficient', dataset: null });
    const solo = Array.from({ length: 12 }, (_, i) => [`Episodio ${i}: reflexiones de la semana`, '2026-05-01T00:00:00Z'] as [string, string]);
    expect(analyzeFeedXml(rss(solo), { feedUrl: 'https://x.example/rss', now: NOW }).level).toBe('insufficient');
    expect(analyzeFeedXml('<html>not a feed</html>', { feedUrl: 'https://x.example/rss', now: NOW }).level).toBe('insufficient');
  });

  it('flags an undeclared language instead of assuming one', () => {
    const a = analyzeFeedXml(rss(interviews, ''), { feedUrl: 'https://x.example/rss', now: NOW });
    expect(a.reasons.some((r) => /does not declare a language/.test(r.en))).toBe(true);
    expect(a.dataset?.language).toBe('');
  });
});

// ------------------------------------------------------------------ search and links
const itunes = (rows: Array<Record<string, unknown>>) => ({ resultCount: rows.length, results: rows });
const row = (id: number, name: string, extra: Record<string, unknown> = {}) => ({ wrapperType: 'track', kind: 'podcast', collectionId: id, collectionName: name, artistName: 'Pub', feedUrl: `https://feeds.example.com/${id}`, collectionViewUrl: `https://podcasts.apple.com/ar/podcast/x/id${id}?uo=4`, country: 'ARG', ...extra });
const CATALOG: CatalogRef[] = [{ id: 'creativo', appleUrl: 'https://podcasts.apple.com/mx/podcast/creativo/id1512341530', feedUrl: 'https://feeds.example.com/creativo', origin: { country: 'mx', status: 'verified' } }];

function deps(calls: string[] = []) {
  return {
    catalog: CATALOG,
    fetchJson: async (url: string) => {
      calls.push(url);
      const u = new URL(url);
      if (u.hostname === 'open.spotify.com') return { title: 'CREATIVO' };
      if (u.hostname === 'www.youtube.com') return { title: 'Entrevista completa', author_name: 'Show Nuevo' };
      if (u.pathname === '/lookup') return itunes([row(Number(u.searchParams.get('id')), 'Show por enlace')]);
      const term = u.searchParams.get('term');
      if (term === 'CREATIVO') return itunes([row(1512341530, 'CREATIVO', { feedUrl: 'https://feeds.example.com/creativo', country: 'MEX' }), row(42, 'Creativo Talks', { country: 'USA' })]);
      if (term === 'Show Nuevo') return itunes([row(77, 'Show Nuevo')]);
      return itunes([]);
    },
    fetchText: async (url: string) => {
      calls.push(url);
      if (url.includes('page')) return { url, status: 200, contentType: 'text/html', text: '<html><body>hello</body></html>' };
      return { url, status: 200, contentType: 'application/rss+xml', text: rss(interviews) };
    },
  };
}

describe('open search by name and by link', () => {
  it('name search keeps foreign results and shows origin only when verified', async () => {
    const hits = await new OpenPodcastSearch(deps()).searchByName('CREATIVO');
    expect(hits.map((h) => [h.name, h.catalogId, h.origin.status, h.store])).toEqual([
      ['CREATIVO', 'creativo', 'verified', 'MEX'],
      ['Creativo Talks', null, 'unverified', 'USA'],
    ]);
  });

  it('resolves Apple links through the lookup API', async () => {
    const r = await new OpenPodcastSearch(deps()).resolveLink('https://podcasts.apple.com/ar/podcast/algo/id123456?i=999');
    expect(r).toMatchObject({ platform: 'apple', status: 'resolved', hits: [{ appleId: 123456, origin: { status: 'unverified' } }] });
  });

  it('Spotify and YouTube links: title via oEmbed, then the user chooses the matching show', async () => {
    const s = await new OpenPodcastSearch(deps()).resolveLink('https://open.spotify.com/show/5XWpDtVEGxBhRJ4h9p2nBd?si=abc');
    expect(s).toMatchObject({ platform: 'spotify', status: 'choose', linkTitle: 'CREATIVO' });
    expect(s.hits[0].name).toBe('CREATIVO'); // exact title first, but never auto-selected
    const y = await new OpenPodcastSearch(deps()).resolveLink('https://www.youtube.com/watch?v=abc123');
    expect(y).toMatchObject({ platform: 'youtube', status: 'choose' });
    expect(y.hits.map((h) => h.name)).toContain('Show Nuevo');
    const bad = await new OpenPodcastSearch(deps()).resolveLink('https://open.spotify.com/playlist/xyz');
    expect(bad.status).toBe('unresolved');
  });

  it('direct RSS links are read; other pages are not treated as feeds', async () => {
    const ok = await new OpenPodcastSearch(deps()).resolveLink('https://feeds.example.com/rss');
    expect(ok).toMatchObject({ platform: 'rss', status: 'resolved', hits: [{ name: 'Show de Prueba', origin: { status: 'unverified' } }] });
    const page = await new OpenPodcastSearch(deps()).resolveLink('https://example.com/page');
    expect(page.status).toBe('unresolved');
    expect(await new OpenPodcastSearch(deps()).resolveLink('no es un enlace')).toMatchObject({ status: 'unresolved' });
  });
});

describe('/api/podcasts', () => {
  it('analyzes a show outside the catalog, in MOCK, with origin not verified', async () => {
    const d = deps();
    const r = await handlePodcasts({ action: 'analyze', feedUrl: 'https://feeds.example.com/new' }, { PROFILE_LOOKUP: '0' }, { fetchText: d.fetchText, now: NOW });
    const b = r.body as { analysis: { level: string }; result: { qlooMode: string; recommendations: unknown[]; origin: { status: string } } };
    expect(r.status).toBe(200);
    expect(b.analysis.level).toBe('complete');
    expect(b.result.qlooMode).toBe('MOCK');
    expect(b.result.origin.status).toBe('unverified');
    expect(b.result.recommendations.length).toBeGreaterThan(0);
  });

  it('reports a source it cannot analyze, with the reason, and no result', async () => {
    const r = await handlePodcasts({ action: 'analyze', feedUrl: 'https://feeds.example.com/short' }, { PROFILE_LOOKUP: '0' }, { fetchText: async (url) => ({ url, status: 200, contentType: 'application/rss+xml', text: rss(interviews.slice(0, 2)) }) });
    expect(r.body).toMatchObject({ analysis: { level: 'insufficient' }, result: null });
  });

  it('rejects unsafe feed URLs with a 400 and validates input', async () => {
    const r = await handlePodcasts({ action: 'analyze', feedUrl: 'https://127.0.0.1/admin' }, { PROFILE_LOOKUP: '0' });
    expect(r.status).toBe(400);
    expect((await handlePodcasts({ action: 'search', term: 'x' }, {})).status).toBe(400);
    expect((await handlePodcasts({ action: 'nope' } as never, {})).status).toBe(400);
  });

  it('caps outbound calls per request', async () => {
    const calls: string[] = [];
    const d = deps(calls);
    // A YouTube link needs oEmbed + up to 2 searches = 3 calls: within budget.
    await handlePodcasts({ action: 'resolve', url: 'https://www.youtube.com/watch?v=budget1' }, {}, { fetchJson: d.fetchJson });
    expect(calls.length).toBeLessThanOrEqual(3);
  });
});
