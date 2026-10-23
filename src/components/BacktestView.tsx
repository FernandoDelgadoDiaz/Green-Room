import { useState } from 'react';
import type { BacktestResult } from '../../core/backtest';
import { api, type ShowSummary } from '../api';
import { useI18n } from '../i18n';
import { Badge } from './Badge';

const CUTOFFS = ['2024-01-01', '2024-07-01', '2025-01-01', '2025-07-01'];

export function BacktestView({ shows }: { shows: ShowSummary[] }) {
  const { lang, t } = useI18n();
  const [showId, setShowId] = useState('diary-of-a-ceo');
  const [cutoff, setCutoff] = useState('2025-01-01');
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.backtest(showId, cutoff));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="font-display text-3xl">{t('bt.title')}</h3>
        <p className="mt-2 max-w-3xl text-sm text-stone-400">{t('bt.intro')}</p>
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs uppercase tracking-widest text-stone-500">{t('bt.show')}</span>
            <select className="rounded-lg border border-white/15 bg-stage-800 px-3 py-2" value={showId} onChange={(e) => setShowId(e.target.value)}>
              {shows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs uppercase tracking-widest text-stone-500">{t('bt.cutoff')}</span>
            <select className="rounded-lg border border-white/15 bg-stage-800 px-3 py-2" value={cutoff} onChange={(e) => setCutoff(e.target.value)}>
              {CUTOFFS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <button className="btn-primary" disabled={loading} onClick={run}>{loading ? t('bt.running') : t('bt.run')}</button>
        </div>
        {error && <p className="mt-3 text-sm text-red-300">{t('state.error')} {error}</p>}
      </div>

      {result && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="card overflow-x-auto p-6">
            <div className="flex flex-wrap items-center gap-2 text-sm text-stone-400">
              <span>{result.targetName}</span>·<span>{t('bt.history', { date: result.cutoff.slice(0, 10), n: result.historyEpisodes })}</span>·
              <span>{t('bt.until', { date: result.horizonEnd.slice(0, 10) })}</span>
              <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${result.leakage.ok ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                {result.leakage.ok ? t('bt.leakOk') : t('bt.leakFail')}
              </span>
            </div>
            <table className="mt-5 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-stone-500">
                  <th className="pb-2">{t('bt.method')}</th><th className="pb-2 text-right">{t('bt.hits')} @5</th><th className="pb-2 text-right">@10</th><th className="pb-2 text-right">@25</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                <tr>
                  <td className="py-3 text-stone-400">{t('bt.random')}</td>
                  {Object.values(result.randomExpectation).map((v, i) => <td key={i} className="py-3 text-right tabular-nums text-stone-400">{v.toFixed(2)}</td>)}
                </tr>
                {result.arms.map((a) => (
                  <tr key={a.label} className={a.isEvidence ? '' : 'opacity-60'}>
                    <td className="py-3">
                      <span className="mr-2">{lang === 'es' ? a.labelEs : a.label}</span>
                      <Badge p={a.qlooMode === 'OFF' ? 'OFF' : a.qlooMode} />
                      {!a.isEvidence && <p className="mt-1 text-xs text-fuchsia-200">{t('bt.notEvidence')}</p>}
                    </td>
                    {Object.values(a.hitsAt).map((v, i) => <td key={i} className="py-3 text-right text-lg font-semibold tabular-nums">{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-6">
              <p className="text-xs uppercase tracking-widest text-stone-500">{t('bt.hitsTitle')}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {result.arms[0].hits.map((h) => (
                  <li key={h.name}>
                    <span className="text-brass-300">#{h.rank}</span> {h.name} <span className="text-stone-500">— {t('bt.booked')} {h.bookedOn.slice(0, 10)}: {h.title}</span>
                  </li>
                ))}
                {result.arms[0].hits.length === 0 && <li className="text-stone-400">{t('bt.noHits')}</li>}
              </ul>
            </div>
          </div>
          <div className="space-y-6">
            <div className="card p-6 text-sm">
              <p className="text-xs uppercase tracking-widest text-stone-500">{t('bt.truth')}</p>
              <p className="mt-2 text-stone-300">{t('bt.truthText', { hidden: result.hidden.length, reachable: result.reachable.length })}</p>
              {result.reachable.length > 0 && <p className="mt-2 text-stone-400">{t('bt.reachable')}: {result.reachable.join(', ')}.</p>}
              <p className="mt-2 text-stone-500">{t('bt.pool', { n: result.poolSize })}</p>
            </div>
            <div className="card p-6 text-sm">
              <p className="text-xs uppercase tracking-widest text-stone-500">{t('bt.limitations')}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-stone-400">{(lang === 'es' ? result.limitationsEs : result.limitations).map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
