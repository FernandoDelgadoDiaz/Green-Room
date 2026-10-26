import type { Recommendation } from '../../core/agent/agent';
import type { RecommendResult, ShowSummary } from '../api';
import { useI18n } from '../i18n';
import { Badge } from './Badge';
import { GuestAvatar } from './GuestAvatar';
import { agentSteps, audienceRead, guestWhy, withQlooFate } from '../whyThese';

/**
 * "Why these five", right under the portraits: what Qloo inferred about the audience, one short
 * reason per guest, and what the agent did. Plain words; the technical detail stays further down.
 * With `without`, it explains the list without Qloo instead: evidence only, and the affinity Qloo
 * measured afterwards, next to Qloo's own picks.
 */
export function WhyThese({ result, show, recs, without }: { result: RecommendResult; show: ShowSummary; recs: Recommendation[]; without?: { onShowQloo: () => void } }) {
  const { lang, t } = useI18n();
  if (without) return <WithoutQloo result={result} show={show} recs={recs} onShowQloo={without.onShowQloo} />;
  const live = result.qlooMode === 'LIVE';
  const aud = audienceRead(result, show.name, lang);
  const steps = agentSteps(result, show.name, lang);
  const jump = (key: string) => document.getElementById(`rec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <section className="card border border-white/10 p-5 sm:p-6">
      <h3 className="font-display text-3xl sm:text-4xl">{t('why.title')}</h3>
      <p className="mt-1 text-sm text-stone-400">{t('why.lead')}</p>
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-6">
          {live && (
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-emerald-300">
                {t('why.audience')} <Badge p="LIVE" />
              </p>
              {aud.profile && <p className="mt-2 text-lg text-stone-100">{t('why.profile', { p: aud.profile })}</p>}
              {aud.likes.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-stone-300">{t('why.alsoLikes')}</p>
                  {aud.likes.map((l) => (
                    <div key={l.label} className="flex flex-wrap items-baseline gap-1.5">
                      <span className="w-20 shrink-0 text-[11px] uppercase tracking-widest text-stone-500">{l.label}</span>
                      {l.names.map((n) => (
                        <span key={n} className="rounded-full bg-emerald-400/10 px-2.5 py-0.5 text-xs text-emerald-100">{n}</span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-stone-400">{aud.how}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">{t('why.steps')}</p>
            <ol className="mt-2 space-y-2 text-sm text-stone-300">
              {steps.map((s, i) => (
                <li key={s} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold tabular-nums text-stone-200">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">{t('why.each')}</p>
          <ul className="mt-2 divide-y divide-white/5">
            {recs.map((r, i) => {
              const w = guestWhy(r, lang, Date.now(), show.name, { kindClaims: (result.cardsVersion ?? 0) >= 2 });
              // The same "kind of guest" sentence only once in the block.
              const kind = w.kind && !recs.slice(0, i).some((p) => guestWhy(p, lang, Date.now(), show.name, { kindClaims: (result.cardsVersion ?? 0) >= 2 }).kind === w.kind) ? w.kind : null;
              const offers = [w.offers, kind].filter(Boolean).join(' ') || null;
              return (
                <li key={r.key} className="flex gap-3 py-3">
                  <GuestAvatar name={r.name} profile={result.profiles[r.key]} size="sm" />
                  <div className="min-w-0 space-y-1 text-sm">
                    <button onClick={() => jump(r.key)} className="font-semibold text-white hover:text-brass-300">
                      {r.rank}. {r.name}
                    </button>
                    {live && <p className="text-emerald-100"><span className="mr-1.5 text-[11px] font-semibold uppercase tracking-widest text-emerald-300">{t('why.qloo')}</span>{w.qloo}</p>}
                    {offers && <p className="text-stone-300"><span className="mr-1.5 text-[11px] font-semibold uppercase tracking-widest text-brass-300">{t('why.offers')}</span>{offers}</p>}
                    {w.timely && <p className="text-stone-400"><span className="mr-1.5 text-[11px] font-semibold uppercase tracking-widest text-stone-500">{t('why.timely')}</span>{w.timely}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

function WithoutQloo({ result, show, recs, onShowQloo }: { result: RecommendResult; show: ShowSummary; recs: Recommendation[]; onShowQloo: () => void }) {
  const { lang, t } = useI18n();
  const rows = result.comparison?.rows ?? [];
  const b = result.comparison?.means?.withoutQloo;
  const tasteVals = (result.tasteRecommendations ?? []).map((r) => r.qlooAudience?.affinity).filter((x): x is number => typeof x === 'number');
  const tasteMean = tasteVals.length >= 3 ? tasteVals.reduce((x, y) => x + y, 0) / tasteVals.length : null;
  const pct = (v: number) => Math.round(v * 100);
  const jump = (key: string) => document.getElementById(`rec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <section className="card border border-white/10 p-5 sm:p-6">
      <h3 className="font-display text-3xl sm:text-4xl">{t('why.withoutTitle')}</h3>
      <p className="mt-1 text-sm text-stone-400">{t('why.withoutLead')}</p>
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-3 rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-4 self-start">
          {b && b.affinityKnown >= 3 && b.affinity !== null && <p className="text-lg text-stone-100">{t('why.withoutAff', { b: pct(b.affinity) })}</p>}
          {tasteMean !== null && <p className="text-lg text-emerald-200">{t('why.withoutTaste', { t: pct(tasteMean) })}</p>}
          <button onClick={onShowQloo} className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-semibold text-stage-950 hover:bg-emerald-300">
            {t('why.withoutBtn')} →
          </button>
          <p className="text-[11px] text-stone-400">{t('why.withoutOnly')}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">{t('why.each')}</p>
          <ul className="mt-2 divide-y divide-white/5">
            {recs.map((r, i) => {
              const w = guestWhy(r, lang, Date.now(), show.name, { kindClaims: (result.cardsVersion ?? 0) >= 2 });
              const kind = w.kind && !recs.slice(0, i).some((p) => guestWhy(p, lang, Date.now(), show.name, { kindClaims: (result.cardsVersion ?? 0) >= 2 }).kind === w.kind) ? w.kind : null;
              const offers = [w.offers, kind].filter(Boolean).join(' ') || null;
              const fate = withQlooFate(rows.find((x) => x.key === r.key), lang);
              return (
                <li key={r.key} className="flex gap-3 py-3">
                  <GuestAvatar name={r.name} profile={result.profiles[r.key]} size="sm" />
                  <div className="min-w-0 space-y-1 text-sm">
                    <button onClick={() => jump(r.key)} className="font-semibold text-white hover:text-brass-300">
                      {r.rank}. {r.name}
                    </button>
                    {offers && <p className="text-stone-300"><span className="mr-1.5 text-[11px] font-semibold uppercase tracking-widest text-brass-300">{t('why.offers')}</span>{offers}</p>}
                    {w.timely && <p className="text-stone-400"><span className="mr-1.5 text-[11px] font-semibold uppercase tracking-widest text-stone-500">{t('why.timely')}</span>{w.timely}</p>}
                    {fate && <p className="text-emerald-100/90"><span className="mr-1.5 text-[11px] font-semibold uppercase tracking-widest text-emerald-300">{t('why.withQloo')}</span>{fate}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
