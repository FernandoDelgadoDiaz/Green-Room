import { useEffect, useState } from 'react';
import { api, liveToken, type Catalog, type FeedAnalysisSummary, type LiveStatus, type PodcastHit, type RecommendResult, type ShowSummary } from './api';
import { CatalogPicker } from './components/CatalogPicker';
import { Badge } from './components/Badge';
import { RecommendView } from './components/RecommendView';
import { BacktestView } from './components/BacktestView';
import { LanguageProvider, LanguageSwitch, useI18n } from './i18n';
import type { Provenance } from '../core/types';

type Tab = 'recommend' | 'backtest' | 'method';

function MethodView({ shows, mode }: { shows: ShowSummary[]; mode: 'LIVE' | 'MOCK' }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
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

  useEffect(() => {
    api.shows().then((r) => { setShows(r.shows); if (!liveToken.get()) setMode(r.qlooMode); }).catch((e) => setError(String(e)));
    api.catalog().then(setCatalog).catch((e) => setError(String(e)));
  }, []);

  const [external, setExternal] = useState<{ hit: PodcastHit; analysis: FeedAnalysisSummary | null } | null>(null);

  // A show found through the open search (not in the catalog): analyzed from its live RSS feed.
  const analyzeHit = async (hit: PodcastHit) => {
    setSelected(`ext:${hit.feedUrl}`);
    setExternal({ hit, analysis: null });
    setResult(null);
    setLoading(true);
    setError(null);
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

  const analyze = async (id: string) => {
    setExternal(null);
    setSelected(id);
    setResult(null);
    setLoading(true);
    setError(null);
    try {
      setResult(await api.recommend(id));
    } catch (e) {
      setError(String(e));
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
          <h1 className="font-display text-4xl sm:text-5xl">{t('brand.tagline')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-stone-400">{t('brand.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-stone-400">
          <LanguageSwitch />
          <span className="flex items-center gap-1.5">Qloo <Badge p={mode} /></span>
        </div>
      </header>
      <PrivateLive onMode={setMode} />

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
              <button className="btn-ghost" onClick={() => (setSelected(null), setResult(null), setExternal(null))}>
                {t('cat.change')}
              </button>
            )}
            {loading && <p className="text-sm text-stone-400">{t('state.analyzing')}</p>}
            {external?.analysis && <AnalysisStatus hit={external.hit} analysis={external.analysis} />}
            {show && result && (
              <section>
                <h2 className="mb-3 text-xs uppercase tracking-widest text-stone-500">{t('step.results')} {show.name}</h2>
                <RecommendView show={show} result={result} />
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
