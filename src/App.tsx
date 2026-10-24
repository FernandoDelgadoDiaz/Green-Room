import { useEffect, useState } from 'react';
import { api, LiveError, liveToken, type Catalog, type FeedAnalysisSummary, type LiveStatus, type PodcastHit, type PublicLiveStatus, type RecommendResult, type ShowSummary } from './api';
import { CatalogPicker } from './components/CatalogPicker';
import { Badge } from './components/Badge';
import { RecommendView } from './components/RecommendView';
import { BacktestView } from './components/BacktestView';
import { CoverageView } from './components/CoverageView';
import { LanguageProvider, LanguageSwitch, useI18n } from './i18n';
import type { Provenance } from '../core/types';

type Tab = 'recommend' | 'backtest' | 'method';

function MethodView({ shows, mode }: { shows: ShowSummary[]; mode: 'LIVE' | 'MOCK' }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <CoverageView />
      <div className="card p-6">
        <h3 className="font-display text-3xl">{t('m.read')}</h3>
        <ul className="mt-4 space-y-3 text-sm">
          {(['VERIFIED', 'INFERRED', 'MOCK', 'LIVE'] as Provenance[]).map((p) => (
            <li key={p} className="flex items-start gap-3"><Badge p={p} className="mt-0.5" /><span className="text-stone-300">{t(`prov.${p}`)}</span></li>
          ))}
        </ul>
        <p className="mt-5 text-sm text-stone-400">
          {t('m.mode')}: <Badge p={mode} />. {mode === 'MOCK' ? t('m.modeMock') : t('m.modeLive')}
        </p>
        <h4 className="mt-6 font-semibold">{t('m.adds')}</h4>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-stone-400">
          <li>{t('m.adds1')}</li>
          <li>{t('m.adds2')}</li>
          <li>{t('m.adds3')}</li>
        </ol>
        <h4 className="mt-6 font-semibold">{t('m.photos')}</h4>
        <p className="mt-2 text-sm text-stone-400">{t('m.photosText')}</p>
      </div>
      <div className="card p-6">
        <h3 className="font-display text-3xl">{t('m.sources')}</h3>
        <ul className="mt-4 space-y-4 text-sm">
          {shows.map((s) => (
            <li key={s.id}>
              <p className="font-semibold">{s.name}</p>
              <p className="break-all text-stone-400">{t('m.feed')}: <a className="text-brass-300 hover:underline" href={s.source.feedUrl} target="_blank" rel="noreferrer">{s.source.feedUrl}</a></p>
              <p className="text-stone-500">{t('m.snapshot', { date: s.source.retrievedAt })}</p>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-xs text-stone-500">{t('m.noAudience')}</p>
      </div>
    </div>
  );
}

/** Shown only with ?private in the URL or an active token. The token is typed, never bundled. */
function PrivateLive({ onMode }: { onMode: (m: 'LIVE' | 'MOCK') => void }) {
  const { t } = useI18n();
  const [visible] = useState(() => new URLSearchParams(window.location.search).has('private') || Boolean(liveToken.get()));
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const check = async (token: string) => {
    const s = await api.liveStatus(token);
    setStatus(s);
    if (s.state === 'denied' || s.state === 'unconfigured') liveToken.set(null);
    onMode(s.state === 'live' ? 'LIVE' : 'MOCK');
  };
  useEffect(() => {
    const tok = liveToken.get();
    if (tok) void check(tok);
  }, []);
  if (!visible) return null;
  const active = Boolean(liveToken.get());
  return (
    <div className="mt-4 rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/5 p-3 text-xs text-stone-300">
      <p className="font-semibold text-fuchsia-200">{t('live.title')}</p>
      {active ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span>{status?.state === 'live' ? t('live.live') : status?.state === 'off' ? t('live.off') : status ? `${t('live.error')}: ${'message' in status ? status.message : ''}` : '…'}</span>
          <button className="btn-ghost" onClick={() => { liveToken.set(null); setStatus(null); onMode('MOCK'); }}>{t('live.exit')}</button>
        </div>
      ) : (
        <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { liveToken.set(draft.trim()); setDraft(''); void check(draft.trim()); } }}>
          <input type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('live.placeholder')} className="w-64 rounded-md border border-white/15 bg-black/30 px-2 py-1" />
          <button type="submit" className="btn-ghost">{t('live.enter')}</button>
          {status && status.state !== 'live' && <span>{status.state === 'denied' ? t('live.denied') : status.state === 'unconfigured' ? t('live.unconfigured') : status.state === 'off' ? t('live.off') : `${t('live.error')}: ${status.message}`}</span>}
        </form>
      )}
    </div>
  );
}

/** How far a show outside the catalog can be analyzed, why, and which sources were read. */
function AnalysisStatus({ hit, analysis }: { hit: PodcastHit; analysis: FeedAnalysisSummary }) {
  const { lang, t } = useI18n();
  const tone = analysis.level === 'complete' ? 'border-emerald-400/30 text-emerald-200' : analysis.level === 'limited' ? 'border-brass-400/30 text-brass-200' : 'border-red-400/30 text-red-200';
  return (
    <div className={`card border p-4 text-sm ${tone}`}>
      <p className="font-semibold">{hit.name} · {t(`as.${analysis.level}`)}</p>
      <p className="text-xs text-stone-400">{t('os.originUnverifiedLong')}</p>
      {analysis.reasons.length > 0 && <ul className="mt-2 list-disc pl-5 text-stone-300">{analysis.reasons.map((r) => <li key={r.en}>{lang === 'es' ? r.es : r.en}</li>)}</ul>}
      <p className="mt-2 break-all text-[11px] text-stone-500">{t('as.sources')}: {analysis.sources.map((s) => <a key={s} className="mr-2 text-brass-300 hover:underline" href={s} target="_blank" rel="noreferrer">{new URL(s).hostname}</a>)}</p>
    </div>
  );
}

/** States what produced the result: the real Qloo API (when, from cache or not, partial or not). */
function LiveBanner({ result }: { result: RecommendResult }) {
  const { t } = useI18n();
  const l = result.live;
  if (!l) return null;
  const errs = Object.entries(l.errors ?? {}).map(([k, n]) => `${k} ×${n}`).join(', ');
  return (
    <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        <Badge p="LIVE" /> {t('pl.banner', { date: l.computedAt.slice(0, 16).replace('T', ' ') })} · {l.cached ? t('pl.cached') : t('pl.calls', { n: l.qlooCalls ?? 0 })}
      </p>
      {l.stale && <p className="mt-1 text-brass-200">{t('pl.stale')}</p>}
      {l.partial && <p className="mt-1 text-brass-200">{t('pl.partial', { errors: errs })}</p>}
      <p className="mt-1 text-xs text-emerald-200/80">{t('pl.audience')}</p>
    </div>
  );
}

interface Failure {
  code: string;
  message: { en: string; es: string } | null;
  retry: (() => void) | null;
  stale: (() => void) | null;
  staleDate: string | null;
  mock: () => void;
}

/** Honest failure: what happened, and explicit choices. Nothing is substituted automatically. */
function FailureCard({ f }: { f: Failure }) {
  const { lang, t } = useI18n();
  return (
    <div className="card border border-red-400/30 p-4 text-sm text-red-100">
      <p className="font-semibold">{t('pl.failTitle')}</p>
      <p className="mt-1 text-stone-300">{f.message ? (lang === 'es' ? f.message.es : f.message.en) : f.code === 'not_in_directory' ? t('pl.noDirectory') : f.code}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {f.retry && <button className="btn-primary" onClick={f.retry}>{t('pl.retry')}</button>}
        {f.stale && <button className="btn-ghost" onClick={f.stale}>{t('pl.useStale', { date: (f.staleDate ?? '').slice(0, 10) })}</button>}
        <button className="btn-ghost" onClick={f.mock}>{t('pl.mock')}</button>
      </div>
    </div>
  );
}

function Shell() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('recommend');
  const [shows, setShows] = useState<ShowSummary[]>([]);
  const [mode, setMode] = useState<'LIVE' | 'MOCK'>('MOCK');
  const [selected, setSelected] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [result, setResult] = useState<RecommendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [publicLive, setPublicLive] = useState<PublicLiveStatus | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  // Public Qloo LIVE is used only when the server says it is available and no private token is active.
  const usePublicLive = () => !liveToken.get() && Boolean(publicLive?.live);

  useEffect(() => {
    // Public LIVE status may arrive first: the catalog's MOCK default must not overwrite it.
    api.shows().then((r) => { setShows(r.shows); if (!liveToken.get()) setMode((m) => (m === 'LIVE' ? m : r.qlooMode)); }).catch((e) => setError(String(e)));
    api.catalog().then(setCatalog).catch((e) => setError(String(e)));
    api.publicStatus().then((s) => { setPublicLive(s); if (s.live && !liveToken.get()) setMode('LIVE'); });
  }, []);

  // ?show=<id> opens that show directly (shareable demo links); it waits for the LIVE status first.
  const [deepLinked, setDeepLinked] = useState(false);
  useEffect(() => {
    if (deepLinked || !publicLive || !shows.length) return;
    setDeepLinked(true);
    const id = new URLSearchParams(window.location.search).get('show');
    if (id && shows.some((x) => x.id === id)) void analyze(id);
  }, [publicLive, shows, deepLinked]);
  const setShowParam = (id: string | null) => {
    try {
      const u = new URL(window.location.href);
      if (id) u.searchParams.set('show', id);
      else u.searchParams.delete('show');
      window.history.replaceState(null, '', u);
    } catch {
      /* URL updates are a convenience only */
    }
  };
  const demos = ['all-in', 'this-week-in-startups'].map((id) => shows.find((x) => x.id === id)).filter((x): x is ShowSummary => Boolean(x));

  const [external, setExternal] = useState<{ hit: PodcastHit; analysis: FeedAnalysisSummary | null } | null>(null);

  const start = () => {
    setResult(null);
    setFailure(null);
    setElapsed(null);
    setLoading(true);
    setError(null);
  };

  const fail = (e: unknown, retry: () => void, mock: () => void, show: (stale: unknown) => void) => {
    if (!(e instanceof LiveError)) return setError(String(e));
    const stale = e.staleLive as (RecommendResult & { result?: RecommendResult }) | null;
    const staleResult = stale ? (stale.result ?? stale) : null;
    setFailure({ code: e.code, message: e.explanation, retry: e.retry ? retry : null, stale: stale ? () => (setFailure(null), show(stale)) : null, staleDate: staleResult?.live?.computedAt ?? null, mock });
  };

  // A show found through the open search (not in the catalog), MOCK or explicitly requested.
  const analyzeHitMock = async (hit: PodcastHit) => {
    start();
    try {
      const r = await api.analyzeFeed(hit);
      setExternal({ hit, analysis: r.analysis });
      setResult(r.result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const analyzeHit = async (hit: PodcastHit) => {
    setSelected(`ext:${hit.feedUrl}`);
    setExternal({ hit, analysis: null });
    if (!usePublicLive()) return analyzeHitMock(hit);
    start();
    try {
      if (!hit.appleId) throw new LiveError('not_in_directory', null, false, null);
      const r = await api.analyzeLive(hit.appleId, setElapsed);
      setExternal({ hit, analysis: r.analysis });
      setResult(r.result);
    } catch (e) {
      fail(e, () => void analyzeHit(hit), () => void analyzeHitMock(hit), (s) => {
        const x = s as { analysis: FeedAnalysisSummary; result: RecommendResult };
        setExternal({ hit, analysis: x.analysis });
        setResult(x.result);
      });
    } finally {
      setLoading(false);
    }
  };

  const analyzeMock = async (id: string) => {
    start();
    try {
      setResult(await api.recommend(id));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const analyze = async (id: string) => {
    setExternal(null);
    setSelected(id);
    setShowParam(id);
    if (!usePublicLive()) return analyzeMock(id);
    start();
    try {
      setResult(await api.recommendLive(id, setElapsed));
    } catch (e) {
      fail(e, () => void analyze(id), () => void analyzeMock(id), (s) => setResult(s as RecommendResult));
    } finally {
      setLoading(false);
    }
  };

  const show: ShowSummary | null =
    shows.find((s) => s.id === selected) ??
    (external && result
      ? {
          id: result.showId,
          name: external.hit.name,
          host: external.hit.publisher,
          language: '',
          description: '',
          source: { feedUrl: external.hit.feedUrl ?? '', website: external.hit.appleUrl ?? '', retrievedAt: '', retrievedVia: '', note: '' },
          episodeCount: external.analysis?.stats?.episodes ?? 0,
          withGuests: external.analysis?.stats?.withGuestNames ?? 0,
          firstEpisode: null,
          lastEpisode: external.analysis?.stats?.last ?? null,
          recent: [],
        }
      : null);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-brass-400">Green Room</p>
          <h1 className={`font-display ${selected ? 'text-3xl sm:text-4xl' : 'text-4xl sm:text-5xl'}`}>{t('brand.tagline')}</h1>
          {!selected && <p className="mt-2 max-w-2xl text-sm text-stone-400">{t('brand.subtitle')}</p>}
          {!selected && demos.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-widest text-brass-400">{t('home.demo')}</span>
              {demos.map((d) => (
                <button key={d.id} className="btn-primary" onClick={() => (setTab('recommend'), void analyze(d.id))}>
                  {d.name.split(' with ')[0]} →
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-stone-400">
          <LanguageSwitch />
          <span className="flex items-center gap-1.5">Qloo <Badge p={mode} /></span>
        </div>
      </header>
      <PrivateLive onMode={setMode} />
      {publicLive && !publicLive.live && !liveToken.get() && <p className="mt-3 text-xs text-stone-500">{t('pl.offNote')}</p>}

      <nav className="mt-6 flex flex-wrap gap-2 sm:mt-8">
        {(
          [
            ['recommend', t('nav.recommend')],
            ['backtest', t('nav.backtest')],
            ['method', t('nav.method')],
          ] as const
        ).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={tab === id ? 'btn-primary' : 'btn-ghost'}>{label}</button>
        ))}
      </nav>

      {error && <p className="mt-6 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">{t('state.error')} {error}</p>}

      <main className="mt-8 space-y-8">
        {tab === 'recommend' && (
          <>
            {!selected && (
              <section>
                {!catalog && !error && <p className="text-sm text-stone-400">{t('state.loadingShows')}</p>}
                {catalog && <CatalogPicker catalog={catalog} selected={selected} onSelect={analyze} onAnalyzeHit={analyzeHit} />}
              </section>
            )}
            {selected && (
              <button className="btn-ghost" onClick={() => (setSelected(null), setResult(null), setExternal(null), setFailure(null), setShowParam(null))}>
                {t('cat.change')}
              </button>
            )}
            {loading && <p className="text-sm text-stone-400">{usePublicLive() ? t('pl.running') : t('state.analyzing')}{elapsed !== null && ` · ${elapsed} s`}</p>}
            {failure && <FailureCard f={failure} />}
            {external?.analysis && <AnalysisStatus hit={external.hit} analysis={external.analysis} />}
            {show && result && (
              <section>
                <h2 className="mb-3 text-xs uppercase tracking-widest text-stone-500">{t('step.results')} {show.name}</h2>
                <RecommendView show={show} result={result} banner={<LiveBanner result={result} />} />
              </section>
            )}
          </>
        )}
        {tab === 'backtest' && <BacktestView shows={shows} />}
        {tab === 'method' && <MethodView shows={shows} mode={mode} />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <Shell />
    </LanguageProvider>
  );
}
