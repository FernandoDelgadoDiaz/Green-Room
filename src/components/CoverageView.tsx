import { useEffect, useState } from 'react';
import { coverageByCountry, type CoverageRow } from '../../core/coverage';
import { api } from '../api';
import { useI18n } from '../i18n';
import { countryName } from '../why';
import { Badge } from './Badge';

const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

/** How much Qloo knew, per country, in the live analyses Green Room has run. Counts only. */
export function CoverageView() {
  const { lang, t } = useI18n();
  const [rows, setRows] = useState<CoverageRow[] | null>(null);
  useEffect(() => {
    api.coverage().then(setRows).catch(() => setRows([]));
  }, []);
  if (rows === null) return <div className="card p-6 text-sm text-stone-400">{t('cov.loading')}</div>;
  const countries = coverageByCountry(rows);
  return (
    <div className="card p-6 lg:col-span-2">
      <h3 className="flex flex-wrap items-center gap-2 font-display text-3xl">{t('cov.title')} <Badge p="LIVE" /></h3>
      <p className="mt-1 max-w-3xl text-sm text-stone-400">{t('cov.lead')}</p>
      {!rows.length ? (
        <p className="mt-4 text-sm text-stone-400">{t('cov.empty')}</p>
      ) : (
        <>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {countries.map((c) => {
              const share = pctOf(c.showFound, c.shows);
              return (
                <div key={c.country ?? 'unknown'} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-widest text-stone-500">{c.country ? countryName(c.country, lang) : t('cov.unverified')}</p>
                  <p className="mt-2 text-4xl font-semibold tabular-nums">{share === null ? '—' : `${share}%`}</p>
                  <p className="text-xs text-stone-400">{t('cov.known', { a: c.showFound, n: c.shows })}</p>
                  <div className="mt-2 h-2 rounded-full bg-white/10">
                    <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${share ?? 0}%` }} />
                  </div>
                  <ul className="mt-3 space-y-0.5 text-xs text-stone-300">
                    {c.guestsSearched > 0 && <li>{t('cov.guestsLine', { c: c.guestsConfirmed, n: c.guestsSearched })}</li>}
                    <li>{t('cov.profile', { a: c.audienceProfile, n: c.shows })}</li>
                    <li>{t('cov.verified', { a: c.qlooVerified })}</li>
                    <li>{t('cov.changed', { a: c.changedTopFive, n: c.shows })}</li>
                  </ul>
                </div>
              );
            })}
          </div>
          <details className="mt-4 text-xs text-stone-400">
            <summary className="cursor-pointer">{t('cov.perShow', { n: rows.length })}</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead className="text-stone-500">
                  <tr>
                    <th className="py-1 pr-3 font-normal">{t('cov.col.show')}</th>
                    <th className="py-1 pr-3 font-normal">{t('cov.col.country')}</th>
                    <th className="py-1 pr-3 font-normal">{t('cov.col.found')}</th>
                    <th className="py-1 pr-3 font-normal">{t('cov.col.guests')}</th>
                    <th className="py-1 pr-3 font-normal">{t('cov.col.verified')}</th>
                    <th className="py-1 pr-3 font-normal">{t('cov.col.profile')}</th>
                    <th className="py-1 pr-3 font-normal">{t('cov.col.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.showId + r.computedAt} className="border-t border-white/5 text-stone-300">
                      <td className="py-1 pr-3">{r.showName}</td>
                      <td className="py-1 pr-3">{r.country ? countryName(r.country, lang) : '—'}</td>
                      <td className="py-1 pr-3">{r.showFound ? '✓' : '✗'}</td>
                      <td className="py-1 pr-3 tabular-nums">{r.guestsSearched ? `${r.guestsConfirmed}/${r.guestsSearched}` : '—'}</td>
                      <td className="py-1 pr-3 tabular-nums">{r.qlooVerified}/{r.qlooProposed}</td>
                      <td className="py-1 pr-3">{r.audienceProfile ? '✓' : '✗'}</td>
                      <td className="py-1 pr-3 tabular-nums">{r.computedAt.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="mt-3 text-[11px] text-stone-500">{t('cov.note')}</p>
        </>
      )}
    </div>
  );
}
