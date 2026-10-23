import { useEffect, useState } from 'react';
import { api, type RecommendResult, type ShowSummary } from './api';
import { Badge } from './components/Badge';
import { RecommendView } from './components/RecommendView';
import { BacktestView } from './components/BacktestView';
import { LanguageProvider, LanguageSwitch, useI18n } from './i18n';
import type { Provenance } from '../core/types';

type Tab = 'recommend' | 'backtest' | 'method';

function ShowPicker({ shows, selected, onSelect }: { shows: ShowSummary[]; selected: string | null; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {shows.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`card p-5 text-left transition hover:border-brass-400/50 ${selected === s.id ? 'border-brass-400/70 ring-1 ring-brass-400/40' : ''}`}
        >
          <p className="text-xs uppercase tracking-widest text-stone-500">
            {s.language === 'es' ? t('lang.es') : t('lang.en')} · {t('show.hostedBy')} {s.host}
          </p>
          <h3 className="mt-1 font-display text-2xl">{s.name}</h3>
          <p className="mt-1 text-sm text-stone-400">{(['lex-fridman', 'diary-of-a-ceo', 'creativo'] as const).includes(s.id as never) ? t(`showdesc.${s.id as 'creativo'}`) : s.description}</p>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-400">
            <span>{s.episodeCount} {t('show.episodes')}</span>
            <span>{s.withGuests} {t('show.withGuests')}</span>
            <span>{s.firstEpisode?.slice(0, 4)}–{s.lastEpisode?.slice(0, 4)}</span>
          </div>
          <p className="mt-3 flex items-center gap-2 text-[11px] text-stone-500"><Badge p="VERIFIED" /> {t('show.feed')} {s.source.retrievedAt}</p>
        </button>
      ))}
    </div>
  );
}

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

function Shell() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('recommend');
  const [shows, setShows] = useState<ShowSummary[]>([]);
  const [mode, setMode] = useState<'LIVE' | 'MOCK'>('MOCK');
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<RecommendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.shows().then((r) => { setShows(r.shows); setMode(r.qlooMode); }).catch((e) => setError(String(e)));
  }, []);

  const analyze = async (id: string) => {
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

  const show = shows.find((s) => s.id === selected) ?? null;

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
            <section>
              <h2 className="mb-3 text-xs uppercase tracking-widest text-stone-500">{t('step.pick')}</h2>
              {shows.length === 0 && !error && <p className="text-sm text-stone-400">{t('state.loadingShows')}</p>}
              <ShowPicker shows={shows} selected={selected} onSelect={analyze} />
            </section>
            {loading && <p className="text-sm text-stone-400">{t('state.analyzing')}</p>}
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
