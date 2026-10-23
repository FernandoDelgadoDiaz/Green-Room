import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Recommendation, TraceStep } from '../../core/agent/agent';
import type { GuestProfile } from '../../core/profiles';
import { draftProposal } from '../../core/pitch';
import type { RecommendResult, ShowSummary } from '../api';
import { useI18n } from '../i18n';
import { Badge } from './Badge';
import { GuestAvatar } from './GuestAvatar';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}`);

export function AgentTrace({ steps, done }: { steps: TraceStep[]; done: boolean }) {
  const { lang, t } = useI18n();
  return (
    <ol className="relative space-y-3 border-l border-white/10 pl-5">
      {steps.map((s, i) => {
        const txt = lang === 'es' ? s.es : s;
        return (
          <li key={s.id} className="rise relative" style={{ animationDelay: `${i * 40}ms` }}>
            <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-brass-400" />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-stone-100">{txt.title}</span>
              {s.tool && <code className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-stone-400">{s.tool}</code>}
              <Badge p={s.provenance} />
            </div>
            {txt.why && <p className="mt-1 text-xs italic text-sky-200/80">{t('trace.why')}: {txt.why}</p>}
            <p className="mt-1 text-sm text-stone-400">{txt.detail}</p>
            {txt.decision && <p className="mt-1 text-sm text-brass-300">→ {txt.decision}</p>}
          </li>
        );
      })}
      {!done && <li className="text-sm text-stone-500">…</li>}
    </ol>
  );
}

function Bar({ value, tone }: { value: number | null; tone: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-white/10">
      <div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
    </div>
  );
}

function ProposalModal({ rec, show, result, onClose }: { rec: Recommendation; show: ShowSummary; result: RecommendResult; onClose: () => void }) {
  const { lang, t } = useI18n();
  const proposal = draftProposal(rec, show, result.themes, lang);
  const [copied, setCopied] = useState(false);
  // Portal: ancestors use backdrop-filter, which would otherwise trap a fixed-position overlay.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-2xl overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <GuestAvatar name={rec.name} profile={result.profiles[rec.key]} size="sm" />
            <div>
              <p className="text-xs uppercase tracking-widest text-brass-400">{t('proposal.kicker')}</p>
              <h3 className="font-display text-2xl sm:text-3xl">{proposal.subject}</h3>
            </div>
          </div>
          <button className="btn-ghost" onClick={onClose}>{t('common.close')}</button>
        </div>
        <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-black/30 p-4 font-sans text-sm leading-relaxed text-stone-200">{proposal.body}</pre>
        <div className="mt-4 text-xs text-stone-400">
          <p className="font-semibold text-stone-300">{t('proposal.basedOn')}</p>
          <ul className="mt-1 list-disc pl-5">{proposal.basedOn.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
        <button
          className="btn-primary mt-4"
          onClick={() => {
            navigator.clipboard?.writeText(`${proposal.subject}\n\n${proposal.body}`);
            setCopied(true);
          }}
        >
          {copied ? t('proposal.copied') : t('proposal.copy')}
        </button>
      </div>
    </div>,
    document.body,
  );
}

function specialty(profile: GuestProfile | null | undefined, lang: 'en' | 'es'): string | null {
  if (!profile) return null;
  const d = lang === 'es' ? (profile.description.es ?? profile.description.en) : (profile.description.en ?? profile.description.es);
  return d ? d.charAt(0).toUpperCase() + d.slice(1) : null;
}

function EvidencePanel({ rec, profile }: { rec: Recommendation; profile: GuestProfile | null | undefined }) {
  const { lang, t } = useI18n();
  const extract = lang === 'es' && profile?.extract.es ? { text: profile.extract.es, url: profile.extract.esUrl ?? profile.wikipedia.url, src: 'es.wikipedia.org' } : profile?.extract.en ? { text: profile.extract.en, url: profile.wikipedia.url, src: 'en.wikipedia.org' } : null;
  const topics = [...rec.conversationTopics, ...rec.sharedThemes.map((s) => (lang === 'es' ? s.labelEs : s.label))];
  return (
    <div className="mt-4 space-y-4 rounded-xl bg-black/25 p-4 text-sm">
      {extract && (
        <div>
          <p className="mb-1 text-xs uppercase tracking-widest text-stone-500">{t('ev.who')}</p>
          <blockquote className="border-l-2 border-brass-400/50 pl-3 text-stone-300">{extract.text}</blockquote>
          <p className="mt-1 text-[11px] text-stone-500">
            — <a className="text-brass-300 hover:underline" href={extract.url} target="_blank" rel="noreferrer">{t('ev.wikiSource')} ({extract.src})</a>, CC BY-SA 4.0
          </p>
          {profile && profile.matchEvidence.length > 0 && (
            <p className="mt-1 text-[11px] text-stone-500">{t('ev.identity')}: <span className="text-stone-300">{profile.matchEvidence.join(', ')}</span></p>
          )}
        </div>
      )}
      <div>
        <p className="mb-1 flex items-center gap-2 text-xs uppercase tracking-widest text-stone-500">{t('ev.topics')} <Badge p="INFERRED" /></p>
        <div className="flex flex-wrap gap-2">
          {topics.map((tp) => <span key={tp} className="rounded-full bg-white/5 px-3 py-1 text-xs text-stone-200">{tp}</span>)}
        </div>
        <p className="mt-1 text-[11px] text-stone-500">{t('ev.topicsNote')}</p>
      </div>
      <div>
        <p className="mb-1 flex items-center gap-2 text-xs uppercase tracking-widest text-stone-500">{t('ev.appearances')} <Badge p="VERIFIED" /></p>
        <ul className="space-y-2">
          {rec.appearances.map((a) => (
            <li key={a.episodeId} className="text-stone-300">
              <span className="text-stone-500">{a.published.slice(0, 10)} · {a.showName} · </span>
              {a.url ? <a className="text-brass-300 underline-offset-2 hover:underline" href={a.url} target="_blank" rel="noreferrer">{a.title}</a> : a.title}
            </li>
          ))}
          {rec.appearances.length === 0 && <li className="text-stone-400">{t('ev.noAppearances')}</li>}
        </ul>
      </div>
      <p className="text-[11px] text-stone-500">
        {t('ev.photo')}:{' '}
        {profile?.photo ? (
          <>
            {profile.photo.artist} ·{' '}
            {profile.photo.licenseUrl ? <a className="hover:underline" href={profile.photo.licenseUrl} target="_blank" rel="noreferrer">{profile.photo.license}</a> : profile.photo.license} ·{' '}
            <a className="hover:underline" href={profile.photo.filePage} target="_blank" rel="noreferrer">Wikimedia Commons</a>
          </>
        ) : (
          t('ev.noPhoto')
        )}
      </p>
    </div>
  );
}

function TechnicalDetails({ rec, mode }: { rec: Recommendation; mode: RecommendResult['qlooMode'] }) {
  const { lang, t } = useI18n();
  const c = rec.components;
  const qlooExpl = c.qlooAffinity.provenance === 'MOCK' ? t('comp.qlooMock') : c.qlooAffinity.weight > 0 ? t('comp.qlooLive') : t('comp.qlooOff');
  const rows = [
    [t('tech.topicalFit'), c.themeFit, 'bg-sky-400', t('comp.themeFit')],
    [t('tech.qloo'), c.qlooAffinity, c.qlooAffinity.provenance === 'MOCK' ? 'bg-fuchsia-400' : 'bg-brass-400', qlooExpl],
    [t('tech.momentum'), c.momentum, 'bg-emerald-400', t('comp.momentum')],
    [t('tech.recency'), c.recency, 'bg-emerald-400', t('comp.recency')],
  ] as const;
  return (
    <div className="mt-3 space-y-4 rounded-xl border border-white/10 p-4">
      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-stone-500">{t('tech.components')}</p>
        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          {rows.map(([label, comp, tone, expl]) => (
            <div key={label}>
              <div className="mb-1 flex items-center justify-between gap-1">
                <span className="text-stone-300">{label}</span>
                <Badge p={comp.provenance} />
              </div>
              <Bar value={comp.value} tone={tone} />
              <p className="mt-1 text-[10px] text-stone-500">{pct(comp.value)} · {t('tech.weight')} {comp.weight} — {expl}</p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-stone-500">{t('tech.rationale')}</p>
        <ul className="space-y-1.5">
          {rec.rationale.map((r) => (
            <li key={r.text} className="flex items-start gap-2 text-sm text-stone-300">
              <Badge p={r.provenance} className="mt-0.5 shrink-0" />
              <span>{lang === 'es' ? r.textEs : r.text}</span>
            </li>
          ))}
        </ul>
      </div>
      {rec.qlooEntityId && (
        <p className="text-xs text-stone-500">
          {t('tech.qlooEntity')}: <code>{rec.qlooEntityId}</code> <Badge p={mode === 'LIVE' ? 'LIVE' : 'MOCK'} />
        </p>
      )}
    </div>
  );
}

function RecommendationCard({ rec, show, result }: { rec: Recommendation; show: ShowSummary; result: RecommendResult }) {
  const { lang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pitch, setPitch] = useState(false);
  const profile = result.profiles[rec.key];
  const spec = specialty(profile, lang);
  const latest = rec.appearances[0];
  const themes = rec.sharedThemes.map((s) => (lang === 'es' ? s.labelEs : s.label));
  // Flag simulated values only when one is actually present on this card.
  const isMock = rec.components.qlooAffinity.provenance === 'MOCK' && rec.components.qlooAffinity.value !== null;
  return (
    <article className="card rise p-5">
      <div className="flex items-start gap-4">
        <div className="relative">
          <GuestAvatar name={rec.name} profile={profile} />
          <span className="absolute -left-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-brass-400 font-display text-lg text-stage-950">{rec.rank}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-xl font-semibold leading-tight">{rec.name}</h4>
              <p className="mt-0.5 text-sm text-stone-400">{spec ?? t('card.noSpecialty')}</p>
            </div>
            <div className="hidden shrink-0 text-right sm:block" title={t('card.scoreHelp')}>
              <p className="text-3xl font-semibold tabular-nums">{pct(rec.score)}</p>
              <p className="whitespace-nowrap text-[10px] uppercase tracking-widest text-stone-500 underline decoration-dotted underline-offset-2">{t('card.score')}</p>
            </div>
          </div>
          <p className="mt-1 text-sm sm:hidden" title={t('card.scoreHelp')}>
            <span className="text-2xl font-semibold tabular-nums">{pct(rec.score)}</span>{' '}
            <span className="text-[10px] uppercase tracking-widest text-stone-500 underline decoration-dotted underline-offset-2">{t('card.score')}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <StatusChips rec={rec} show={show} />
          </div>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-widest text-brass-400">{t('card.why')}</p>
        <p className="mt-1 text-sm leading-relaxed text-stone-200">
          {themes.length ? t('card.whyThemes', { themes: new Intl.ListFormat(lang, { type: 'conjunction' }).format(themes), show: show.name }) : t('card.whyNoThemes')}{' '}
          {latest && t('card.whyLatest', { showName: latest.showName, date: latest.published.slice(0, 10) })}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? t('card.hideEvidence') : t('card.evidence')}</button>
        <button className="btn-primary" onClick={() => setPitch(true)}>{t('card.invite')}</button>
      </div>

      {open && <EvidencePanel rec={rec} profile={profile} />}

      <details className="mt-4 group">
        <summary className="cursor-pointer list-none text-xs text-stone-400 hover:text-stone-200">
          <span className="mr-1 inline-block transition group-open:rotate-90">›</span>
          {t('card.technical')}
          {isMock && <span className="ml-2 rounded-full bg-fuchsia-500/20 px-2 py-0.5 text-[10px] font-bold text-fuchsia-200">MOCK · {t('card.mockNote')}</span>}
        </summary>
        <TechnicalDetails rec={rec} mode={result.qlooMode} />
      </details>

      {pitch && <ProposalModal rec={rec} show={show} result={result} onClose={() => setPitch(false)} />}
    </article>
  );
}

/** History, language and identity, each with how sure we are. Shared by recommendations and discoveries. */
function StatusChips({ rec, show }: { rec: Pick<Recommendation, 'history' | 'language' | 'identity'>; show: ShowSummary }) {
  const { lang, t } = useI18n();
  const h = rec.history;
  const langEvidence = lang === 'es' ? rec.language.evidenceEs : rec.language.evidenceEn;
  return (
    <>
      {h.status === 'not_found_complete' ? (
        <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-emerald-300">✓ {t('card.notFoundComplete', { show: show.name, n: h.pastGuestCount, e: h.episodesChecked })}</span>
      ) : (
        <span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-sky-200" title={t('card.notFoundPartialHelp', { m: h.episodesWithoutGuestName, e: h.episodesChecked })}>
          {t('card.notFoundPartial', { show: show.name, n: h.pastGuestCount, c: Math.round(h.coverage * 100) })}
        </span>
      )}
      <span
        title={langEvidence}
        className={`rounded-full px-2.5 py-1 ${rec.language.status === 'confirmed' ? 'bg-emerald-400/10 text-emerald-300' : rec.language.status === 'probable' ? 'bg-sky-400/10 text-sky-200' : 'bg-brass-400/10 text-brass-300'}`}
      >
        {t(`card.lang.${rec.language.status}`, { lang: rec.language.target.toUpperCase() })}
      </span>
      {rec.identity.status === 'pending' && <span className="rounded-full bg-fuchsia-500/15 px-2.5 py-1 text-fuchsia-200">{t('card.identityPending')}</span>}
    </>
  );
}

function DiscoveriesPanel({ result, show }: { result: RecommendResult; show: ShowSummary }) {
  const { t } = useI18n();
  if (!result.discoveries?.length) return null;
  return (
    <div className="card border-fuchsia-400/30 p-5">
      <h3 className="flex items-center gap-2 font-display text-2xl">{t('disc.title')} <Badge p="LIVE" /></h3>
      <p className="mt-1 text-sm text-stone-400">{t('disc.note')}</p>
      <ul className="mt-4 space-y-3">
        {result.discoveries.map((d) => (
          <li key={d.qlooEntityId} className="rounded-xl border border-white/10 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{d.name}</span>
              <span className="text-xs text-stone-500">{t('disc.rank', { n: d.qlooRank })}{d.popularity !== undefined ? ` · ${t('disc.popularity', { p: Math.round(d.popularity * 100) })}` : ''}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]"><StatusChips rec={d} show={show} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RecommendView({ show, result }: { show: ShowSummary; result: RecommendResult }) {
  const { lang, t } = useI18n();
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    setVisible(0);
    const id = setInterval(() => setVisible((v) => (v >= result.trace.length ? v : v + 1)), 220);
    return () => clearInterval(id);
  }, [result]);
  const done = visible >= result.trace.length;
  const warnings = lang === 'es' ? result.warningsEs : result.warnings;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="order-2 space-y-6 lg:order-1">
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-2xl">{t('trace.title')}</h3>
            <span className="text-[11px] text-stone-500">{t('trace.replay')}</span>
          </div>
          <p className="mt-2 text-xs text-stone-500">{t('trace.planner')}</p>
          <div className="mt-4">
            <AgentTrace steps={result.trace.slice(0, visible)} done={done} />
          </div>
        </div>

        <div className="card p-5">
          <h3 className="flex items-center gap-2 font-display text-2xl">{t('themes.title')} <Badge p="INFERRED" /></h3>
          <p className="mt-1 text-xs text-stone-400">{t('themes.note', { n: result.historyEpisodeCount })}</p>
          <div className="mt-4 space-y-3">
            {result.themes.map((th) => (
              <div key={th.id}>
                <div className="flex justify-between text-sm"><span>{lang === 'es' ? th.labelEs : th.label}</span><span className="tabular-nums text-stone-400">{Math.round(th.share * 100)}%</span></div>
                <Bar value={th.share} tone="bg-sky-400" />
                <p className="mt-1 text-[11px] text-stone-500">{th.words.join(' · ')}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="flex items-center gap-2 font-display text-2xl">{t('affinities.title')} <Badge p={result.qlooMode === 'LIVE' ? 'LIVE' : 'MOCK'} /></h3>
          {result.culturalAffinities.some((c) => c.entities.length) ? (
            <div className="mt-3 space-y-3">
              {result.culturalAffinities.map((c) => (
                <div key={c.type}>
                  <p className="text-xs uppercase tracking-widest text-stone-500">{c.type.replace('urn:entity:', '')}</p>
                  <div className="mt-1 flex flex-wrap gap-2">{c.entities.map((e) => <span key={e.entityId} className="rounded-full bg-brass-400/10 px-3 py-1 text-xs text-brass-300">{e.name}</span>)}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-stone-400">{t('affinities.pending')}</p>
          )}
        </div>
      </section>

      <section className="order-1 space-y-4 lg:order-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="font-display text-3xl">{t('recs.title')}</h3>
          <span className="text-xs text-stone-500">{t('recs.meta', { n: result.pastGuestCount, date: result.asOf.slice(0, 10) })}</span>
        </div>
        {warnings.map((w) => <div key={w} className="rounded-xl border border-brass-400/30 bg-brass-400/10 px-4 py-3 text-sm text-brass-300">{w}</div>)}
        {result.qlooMode === 'MOCK' && <div className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-200">{t('recs.mock')}</div>}
        {result.recommendations.map((r) => <RecommendationCard key={r.key} rec={r} show={show} result={result} />)}
        <DiscoveriesPanel result={result} show={show} />
        {result.discarded.length > 0 && (
          <details className="card p-4 text-sm text-stone-300">
            <summary className="cursor-pointer font-semibold">{t('recs.discarded', { n: result.discarded.length })}</summary>
            <ul className="mt-3 space-y-1">
              {result.discarded.slice(0, 30).map((d) => (
                <li key={d.name + d.reason}>
                  <span className="text-stone-100">{d.name}</span> — {lang === 'es' ? d.reasonEs : d.reason}
                  {d.evidence?.url && <> · <a className="text-brass-300 hover:underline" href={d.evidence.url} target="_blank" rel="noreferrer">{t('recs.episode')}</a></>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
