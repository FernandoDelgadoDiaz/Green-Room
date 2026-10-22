import { useEffect, useState } from 'react';
import type { AgentResult } from '../core/agent/agent';
import { api, type ShowSummary } from './api';
import { Badge, PROVENANCE_HELP } from './components/Badge';
import { RecommendView } from './components/RecommendView';
import { BacktestView } from './components/BacktestView';
import type { Provenance } from '../core/types';

type Tab = 'recommend' | 'backtest' | 'method';

const LANG: Record<string, string> = { en: 'English', es: 'Spanish' };

function ShowPicker({ shows, selected, onSelect }: { shows: ShowSummary[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {shows.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`card p-5 text-left transition hover:border-brass-400/50 ${selected === s.id ? 'border-brass-400/70 ring-1 ring-brass-400/40' : ''}`}
        >
          <p className="text-xs uppercase tracking-widest text-stone-500">{LANG[s.language] ?? s.language} · hosted by {s.host}</p>
          <h3 className="mt-1 font-display text-2xl">{s.name}</h3>
          <p className="mt-1 text-sm text-stone-400">{s.description}</p>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-400">
            <span>{s.episodeCount} episodes</span>
            <span>{s.withGuests} with identified guests</span>
            <span>{s.firstEpisode?.slice(0, 4)}–{s.lastEpisode?.slice(0, 4)}</span>
          </div>
          <p className="mt-3 flex items-center gap-2 text-[11px] text-stone-500"><Badge p="VERIFIED" /> official RSS feed, read {s.source.retrievedAt}</p>
        </button>
      ))}
    </div>
  );
}

function MethodView({ shows, mode }: { shows: ShowSummary[]; mode: 'LIVE' | 'MOCK' }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card p-6">
        <h3 className="font-display text-3xl">How to read this demo</h3>
        <ul className="mt-4 space-y-3 text-sm">
          {(['VERIFIED', 'INFERRED', 'MOCK', 'LIVE'] as Provenance[]).map((p) => (
            <li key={p} className="flex items-start gap-3"><Badge p={p} className="mt-0.5" /><span className="text-stone-300">{PROVENANCE_HELP[p]}</span></li>
          ))}
        </ul>
        <p className="mt-5 text-sm text-stone-400">
          Current mode: <Badge p={mode} />. {mode === 'MOCK' ? 'The Qloo hackathon key has not been configured yet, so every Qloo value is simulated, labeled MOCK and excluded from rankings and claims.' : 'Qloo values come from the live hackathon API.'}
        </p>
        <h4 className="mt-6 font-semibold">What Qloo adds (live mode)</h4>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-stone-400">
          <li>Resolves past guests to Qloo person entities (<code>/search</code>).</li>
          <li>Uses them as the audience’s taste signal to find people with affinity (<code>/v2/insights</code>, <code>filter.type=urn:entity:person</code>, excluding past guests).</li>
          <li>Scores candidates against that signal (<code>filter.entities</code>) and maps cross-domain taste: artists, films, books.</li>
        </ol>
      </div>
      <div className="card p-6">
        <h3 className="font-display text-3xl">Data sources</h3>
        <ul className="mt-4 space-y-4 text-sm">
          {shows.map((s) => (
            <li key={s.id}>
              <p className="font-semibold">{s.name}</p>
              <p className="text-stone-400">Feed: <a className="text-brass-300 hover:underline" href={s.source.feedUrl} target="_blank" rel="noreferrer">{s.source.feedUrl}</a></p>
              <p className="text-stone-500">{s.source.note}</p>
              <p className="text-stone-500">Snapshot: {s.source.retrievedAt}. Only titles, dates, links and extracted guest names are stored.</p>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-xs text-stone-500">Green Room does not know who listens to these shows. It never claims audience data; Qloo’s affinities describe taste patterns, not a show’s listeners.</p>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('recommend');
  const [shows, setShows] = useState<ShowSummary[]>([]);
  const [mode, setMode] = useState<'LIVE' | 'MOCK'>('MOCK');
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<AgentResult | null>(null);
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
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-brass-400">Green Room</p>
          <h1 className="font-display text-4xl sm:text-5xl">The guest your audience is waiting for.</h1>
          <p className="mt-2 max-w-2xl text-sm text-stone-400">An agent that reads a podcast’s real episode history, finds people with a verifiable track record, checks they have not been on the show, and explains every pick.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-stone-400">Qloo <Badge p={mode} /></div>
      </header>

      <nav className="mt-8 flex gap-2">
        {(
          [
            ['recommend', 'Recommend guests'],
            ['backtest', 'Backtest'],
            ['method', 'Data & method'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={tab === id ? 'btn-primary' : 'btn-ghost'}>{label}</button>
        ))}
      </nav>

      {error && <p className="mt-6 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}

      <main className="mt-8 space-y-8">
        {tab === 'recommend' && (
          <>
            <section>
              <h2 className="mb-3 text-xs uppercase tracking-widest text-stone-500">1 · Pick a show</h2>
              <ShowPicker shows={shows} selected={selected} onSelect={analyze} />
            </section>
            {loading && <p className="text-sm text-stone-400">The agent is reading the history…</p>}
            {show && result && (
              <section>
                <h2 className="mb-3 text-xs uppercase tracking-widest text-stone-500">2 · Analysis and recommendations for {show.name}</h2>
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
