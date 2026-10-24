import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Recommendation, TraceStep } from '../../core/agent/agent';
import type { GuestProfile } from '../../core/profiles';
import { draftProposal } from '../../core/pitch';
import type { RecommendResult, ShowSummary } from '../api';
import { useI18n } from '../i18n';
import { Badge } from './Badge';
import { GuestAvatar, initials } from './GuestAvatar';
import { audienceSubtitle, citableThemes, whySentences } from '../why';
import { cleanTopic, clipTopic } from '../../core/topic';

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
  const topics = [...rec.conversationTopics.map((t) => cleanTopic(t)).filter((t): t is string => Boolean(t)).map((t) => clipTopic(t)), ...citableThemes(rec).map((s) => (lang === 'es' ? s.labelEs : s.label))];
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
      {rec.external && (
        <div>
          <p className="mb-1 flex items-center gap-2 text-xs uppercase tracking-widest text-stone-500">{t('ext.title')} <Badge p="VERIFIED" /></p>
          <p className="text-stone-300">{(lang === 'es' ? rec.external.description.es : rec.external.description.en) ?? rec.external.description.en ?? rec.external.description.es}</p>
          {rec.external.wikipedia && <blockquote className="mt-1 border-l-2 border-brass-400/50 pl-3 text-stone-400">{rec.external.wikipedia.extract.split(/(?<=\.)\s/).slice(0, 2).join(' ')}</blockquote>}
          <p className="mt-1 text-[11px] text-stone-500">
            {rec.external.sources.map((s) => (
              <a key={s.url} className="mr-3 text-brass-300 hover:underline" href={s.url} target="_blank" rel="noreferrer">{s.name}</a>
            ))}
            {rec.external.wikipedia && 'CC BY-SA 4.0'}
          </p>
          <p className="mt-1 text-[11px] text-stone-500">{rec.external.identityEvidence.join(' · ')}</p>
          <p className="mt-1 text-[11px] text-stone-500">{t('ext.noInterviews')}</p>
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
          {rec.appearances.length === 0 && <li className="text-stone-400">{rec.external ? t('ext.noInterviews') : t('ev.noAppearances')}</li>}
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
        <p className="mb-2 text-xs uppercase tracking-widest text-stone-500">{t('tech.assessment')}</p>
        <ul className="grid gap-2 text-xs text-stone-300 sm:grid-cols-3">
          <li className="rounded-lg bg-white/5 p-2">
            <p className="text-stone-500">{t('tech.a.qloo')}</p>
            {rec.assessment.qlooProposedRank !== null ? t('tech.a.qlooProposed', { n: rec.assessment.qlooProposedRank }) : t('tech.a.qlooNot')}
            {rec.assessment.qlooAffinity !== null && ` · ${t('tech.a.affinity', { v: pct(rec.assessment.qlooAffinity) })}`}
          </li>
          <li className="rounded-lg bg-white/5 p-2">
            <p className="text-stone-500">{t('tech.a.editorial')}</p>
            {pct(rec.assessment.editorialRelevance)}/100
          </li>
          <li className="rounded-lg bg-white/5 p-2">
            <p className="text-stone-500">{t('tech.a.evidence')}</p>
            {t(`tech.a.level.${rec.assessment.evidence.level}` as Parameters<typeof t>[0])} ·{' '}
            {rec.assessment.evidence.kind === 'external' ? t('tech.a.external') : t('tech.a.evidenceDetail', { n: rec.assessment.evidence.appearances, s: rec.assessment.evidence.shows })}
            {rec.assessment.evidence.automaticNamesOnly && ` · ${t('tech.a.automatic')}`}
          </li>
          <li className="rounded-lg bg-white/5 p-2 sm:col-span-3">
            <p className="text-stone-500">{t('tech.a.potential')}</p>
            {t('tech.a.potentialDetail', { n: rec.assessment.editorialPotential.interviewsOnRecord, s: rec.assessment.editorialPotential.showsOnRecord })} · {t('tech.a.availability')}
          </li>
        </ul>
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
  const spec = audienceSubtitle(rec, lang) ?? specialty(profile, lang);
  // Flag simulated values only when one is actually present on this card.
  const isMock = rec.components.qlooAffinity.provenance === 'MOCK' && rec.components.qlooAffinity.value !== null;
  return (
    <article id={`rec-${rec.key}`} className="card rise scroll-mt-6 p-5">
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
        <p className="mt-1 text-sm leading-relaxed text-stone-200">{whySentences(rec, show.name, lang, undefined, { kindClaims: (result.cardsVersion ?? 0) >= 2 }).join(' ')}</p>
        <QlooAudienceRow rec={rec} />
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
function StatusChips({ rec, show }: { rec: Pick<Recommendation, 'history' | 'language' | 'identity'> & Partial<Pick<Recommendation, 'assessment'>>; show: ShowSummary }) {
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
      {rec.assessment && rec.assessment.qlooProposedRank !== null && (
        <span className="rounded-full bg-brass-400/15 px-2.5 py-1 text-brass-300">
          {t(rec.assessment.evidence.kind === 'external' ? 'card.qlooExternal' : 'card.qlooVerified', { n: rec.assessment.qlooProposedRank })}
        </span>
      )}
    </>
  );
}

const SIGNAL_KEYS = { guests: 'sig.guests', podcast: 'sig.podcast', tags: 'sig.tags', 'podcast+tags': 'sig.podcastTags', none: 'sig.none' } as const;

/** Which podcast was analyzed, which signals were used, and the show's habitual languages. */
function AnalysisSummary({ result, show }: { result: RecommendResult; show: ShowSummary }) {
  const { lang, t } = useI18n();
  const lp = result.languageProfile;
  const o = result.origin;
  return (
    <div className="card p-5 text-sm">
      <p className="text-xs uppercase tracking-widest text-stone-500">{t('sum.title')}</p>
      <p className="mt-1 font-display text-2xl">{show.name}</p>
      <ul className="mt-3 space-y-1.5 text-stone-300">
        <li>
          <span className="text-stone-500">{t('sum.origin')}: </span>
          {o && o.status === 'verified' && o.country ? t('sum.originVerified', { country: o.country.toUpperCase() }) : t('sum.originUnverified')}
          {o?.evidence[0] && (
            <>
              {' '}
              · <a className="text-brass-300 hover:underline" href={o.evidence[0].url} target="_blank" rel="noreferrer">{t('sum.source')}</a>
            </>
          )}
        </li>
        <li>
          <span className="text-stone-500">{t('sum.history')}: </span>
          {t('sum.historyDetail', { e: result.historyEpisodeCount, g: result.pastGuestCount, c: Math.round(result.guestCoverage * 100) })}
        </li>
        <li>
          <span className="text-stone-500">{t('sum.languages')}: </span>
          {lang === 'es' ? lp.preferenceEs : lp.preference}{' '}
          <span className="text-stone-500">({t(`sum.conf.${lp.confidence}` as Parameters<typeof t>[0])})</span>
          {lp.internationalGuests.length > 0 && <span className="text-stone-500"> · {t('sum.intl', { n: lp.internationalGuests.length })}</span>}
        </li>
        <li>
          <span className="text-stone-500">{t('sum.signal')}: </span>
          {result.qlooMode === 'LIVE' ? t(SIGNAL_KEYS[result.signalStrategy]) : t('sum.signalMock')}
        </li>
      </ul>
    </div>
  );
}

const CHECK_ICON = (ok: boolean | null) => (ok === true ? '✓' : ok === false ? '✗' : '?');

/** What Qloo proposed, what the agent verified, and what it rejected, with reasons. */
function DiscoveryPanel({ result, show, part }: { result: RecommendResult; show: ShowSummary; part: 'head' | 'details' }) {
  const { lang, t } = useI18n();
  const f = result.funnel;
  const c = result.comparison;
  if (result.qlooMode !== 'LIVE')
    return part === 'details' ? null : (
      <div className="card border-white/10 p-5 text-sm">
        <h3 className="font-display text-2xl">{t('disc.title')}</h3>
        <p className="mt-1 text-stone-400">{t('disc.notLive')}</p>
      </div>
    );
  const steps: Array<[string, number]> = [
    [t('funnel.proposed'), f.proposed],
    [t('funnel.identity'), f.identityVerified],
    [t('funnel.external'), f.externalDocumented],
    [t('funnel.ranked'), f.ranked],
    [t('funnel.shortlist'), f.inShortlist],
  ];
  if (part === 'details')
    return result.qlooProposals.length || result.discoveries.length ? <DiscoveryDetails result={result} show={show} /> : null;
  return (
    <div className="card border-brass-400/30 p-5 text-sm">
      <h3 className="flex items-center gap-2 font-display text-2xl">{t('disc.title')} <Badge p="LIVE" /></h3>
      <p className="mt-1 text-stone-400">{t('disc.note')}</p>
      <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {steps.map(([label, n]) => (
          <li key={label} className="rounded-lg bg-white/5 p-2 text-center">
            <p className="text-2xl font-semibold tabular-nums">{n}</p>
            <p className="text-[11px] text-stone-400">{label}</p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-stone-300">{lang === 'es' ? f.diagnosisTextEs : f.diagnosisText}</p>
      {f.typeErrors > 0 && <p className="mt-1 text-xs text-stone-400">{f.typeErrors} {t('funnel.typeErrors')}</p>}
      {(f.typePending > 0 || f.externalOverCap > 0) && <p className="mt-1 text-xs text-stone-400">{t('funnel.pendingDetail', { t: f.typePending, c: f.externalOverCap })}</p>}
      {result.signalDiagnostics.verdict !== 'ok' && result.signalDiagnostics.verdict !== 'not_run' && <p className="mt-1 text-xs text-brass-300">{t(`sigv.${result.signalDiagnostics.verdict}`)}</p>}
      {f.attempts.length > 1 && <p className="mt-1 text-xs text-sky-200/80">{t('disc.replanned', { a: f.attempts.map((x) => `${x.signal} (${x.proposed})`).join(' → ') })}</p>}
      {c && (
        <div className="mt-3 rounded-lg border border-white/10 p-3">
          <p className="text-xs uppercase tracking-widest text-stone-500">{t('cmp.title')}</p>
          <p className="mt-1 text-stone-200">{lang === 'es' ? c.verdictEs : c.verdict}</p>
          <ul className="mt-1 text-xs text-stone-400">
            <li>{t('cmp.overlap', { n: c.overlap, k: c.k })}</li>
            {c.newRelations.length > 0 && <li>{t('cmp.new', { names: c.newRelations.map((x) => `${x.name}${x.baselineRank ? ` (${t('cmp.baselineRank', { n: x.baselineRank })})` : ''}`).join(', ') })}</li>}
            {c.affinityPromoted.length > 0 && <li>{t('cmp.affinity', { names: c.affinityPromoted.map((x) => `${x.name}${x.baselineRank ? ` (${t('cmp.baselineRank', { n: x.baselineRank })})` : ''}`).join(', ') })}</li>}
            {c.displaced.length > 0 && <li>{t('cmp.displaced', { names: c.displaced.join(', ') })}</li>}
            {c.confirmations.length > 0 && <li>{t('cmp.confirm', { names: c.confirmations.join(', ') })}</li>}
            <li>{t('cmp.pending', { n: c.pending })}</li>
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * What Qloo added to this analysis, up front: people only Qloo found (verified and on-theme, those
 * who can be interviewed in the show's language first) and cultural conversation hooks. The ranking
 * below is unchanged by this card; nobody is promoted.
 */
const AGE_LABEL: Record<string, { en: string; es: string }> = {
  '24_and_younger': { en: 'under 25', es: 'menores de 25' },
  '25_to_29': { en: '25–29', es: '25 a 29' },
  '30_to_34': { en: '30–34', es: '30 a 34' },
  '35_to_44': { en: '35–44', es: '35 a 44' },
  '45_to_54': { en: '45–54', es: '45 a 54' },
  '55_and_older': { en: '55+', es: '55 o más' },
};

/** "Skews 25–29 and 30–34 · slightly more men": the strongest positive affinities in a Qloo profile. */
export function demographicSummary(d: { age: Record<string, number>; gender: Record<string, number> }, lang: 'en' | 'es'): string | null {
  const ages = Object.entries(d.age).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => AGE_LABEL[k]?.[lang] ?? k.replace(/_/g, ' '));
  const male = d.gender.male ?? 0;
  const gender = Math.abs(male) < 0.05 ? null : male > 0 ? (lang === 'es' ? 'algo más hombres' : 'slightly more men') : lang === 'es' ? 'algo más mujeres' : 'slightly more women';
  const parts = [ages.length ? (lang === 'es' ? `más afín entre ${ages.join(' y ')}` : `skews ${ages.join(' and ')}`) : null, gender].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function QlooAudienceRow({ rec }: { rec: Recommendation }) {
  const { lang, t } = useI18n();
  const q = rec.qlooAudience;
  if (!q) return null;
  const items = [
    q.affinity !== null ? t('qa.affinity', { n: Math.round(q.affinity * 100) }) : null,
    q.demographicMatch !== null ? t('qa.match', { n: Math.round(q.demographicMatch * 100) }) : null,
    q.trend ? t(`qa.trend.${q.trend}` as Parameters<typeof t>[0]) : null,
  ].filter(Boolean) as string[];
  if (!items.length) return null;
  const guest = q.demographics ? demographicSummary(q.demographics, lang) : null;
  return (
    <div className="mt-3 rounded-xl border border-emerald-400/25 bg-emerald-500/5 px-3 py-2 text-xs">
      <p className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-emerald-300/80">{t('qa.title')} <Badge p="LIVE" /></p>
      <p className="mt-1 text-stone-200">{items.join(' · ')}</p>
      {guest && <p className="mt-0.5 text-[11px] text-stone-400">{t('qa.guestAudience', { d: guest })}</p>}
    </div>
  );
}

/** Qloo found neither the show nor enough past guests: the audience signal is only generic topic tags. */
export function weakQlooCoverage(result: Pick<RecommendResult, 'qlooMode' | 'signalStrategy'>): boolean {
  return result.qlooMode === 'LIVE' && (result.signalStrategy === 'tags' || result.signalStrategy === 'none');
}

/** Cross-domain hooks people would recognize: drops obscure titles (Qloo popularity below 0.75) and thin domains. */
export function recognizableHooks(result: Pick<RecommendResult, 'culturalAffinities'>, minPopularity = 0.75) {
  return result.culturalAffinities
    .map((c) => ({ ...c, entities: c.entities.filter((e) => (e.popularity ?? 1) >= minPopularity) }))
    .filter((c) => c.entities.length >= 2);
}

function QlooCoverageNotice({ result }: { result: RecommendResult }) {
  const { t } = useI18n();
  const g = result.signalDiagnostics.guests;
  return (
    <div className="mt-3 rounded-xl border border-brass-400/40 bg-brass-400/10 px-4 py-3">
      <p className="font-semibold text-brass-200">{t('qc.weak.title')}</p>
      <p className="mt-1 text-stone-300">{t('qc.weak.body', { c: g.confirmed, n: g.searched })}</p>
      <p className="mt-1 text-[11px] text-stone-400">{t('qc.weak.note')}</p>
    </div>
  );
}

function QlooContribution({ result }: { result: RecommendResult }) {
  const { lang, t } = useI18n();
  if (result.qlooMode !== 'LIVE') return null;
  const fresh = result.discoveryPositions.filter((p) => p.source === 'qloo-external' && p.eligible).sort((a, b) => a.qlooRank - b.qlooRank);
  const speaks = fresh.filter((p) => p.languageConfirmed);
  const others = fresh.filter((p) => !p.languageConfirmed);
  const hooks = recognizableHooks(result);
  const weak = weakQlooCoverage(result);
  const f = result.funnel;
  return (
    <div className="card border border-emerald-400/30 bg-emerald-500/5 p-5 text-sm">
      <h3 className="flex items-center gap-2 font-display text-2xl">{t('qc.title')} <Badge p="LIVE" /></h3>
      <p className="mt-1 text-xs text-stone-400">{t('qc.lead')}</p>
      {weak && <QlooCoverageNotice result={result} />}

      <p className="mt-4 text-xs uppercase tracking-widest text-emerald-300/80">{t('qc.people')}</p>
      {speaks.length ? (
        <ul className="mt-2 space-y-2">
          {speaks.slice(0, 5).map((p) => (
            <li key={p.name}>
              <p className="font-semibold text-stone-100">
                {p.name}
                {p.inTopK && <span className="ml-2 text-xs font-normal text-emerald-300">{t('disc.newInTop')}</span>}
              </p>
              <p className="text-[11px] text-stone-400">{t('qc.suggested', { q: p.qlooRank })}</p>
              {!p.inTopK && (
                <details className="text-[11px] text-stone-500">
                  <summary className="cursor-pointer">{t('qc.whyNot')}</summary>
                  <p className="mt-1">{t('disc.newRow', { q: p.qlooRank, f: Math.round(p.themeFit * 100), p: p.finalRank ?? '—' })}</p>
                  <p>{lang === 'es' ? p.reasonEs : p.reason}</p>
                </details>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-stone-300">{f.proposed ? t('qc.none', { n: f.proposed, d: f.externalDocumented + f.identityVerified }) : t('qc.noneZero')}</p>
      )}
      {others.length > 0 && (
        <details className="mt-2 text-[11px] text-stone-400">
          <summary className="cursor-pointer">{t('qc.otherLang', { n: others.length })}</summary>
          <p className="mt-1">{others.map((p) => p.name).join(' · ')}</p>
        </details>
      )}

      {hooks.length > 0 && !weak && (
        <>
          <p className="mt-4 text-xs uppercase tracking-widest text-emerald-300/80">{t('qc.hooks')}</p>
          <div className="mt-2 space-y-1">
            {hooks.map((c) => (
              <p key={c.type} className="text-stone-300">
                <span className="text-stone-500">{t(`qc.type.${c.type.replace('urn:entity:', '')}` as Parameters<typeof t>[0])}: </span>
                {c.entities.slice(0, 3).map((e) => e.name).join(' · ')}
              </p>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-stone-500">{t('qc.hooksNote')}</p>
        </>
      )}
      {hooks.length > 0 && weak && (
        <details className="mt-4 text-[11px] text-stone-400">
          <summary className="cursor-pointer">{t('qc.weak.hooks')}</summary>
          <div className="mt-1 space-y-0.5">
            {hooks.map((c) => (
              <p key={c.type}>
                <span className="text-stone-500">{t(`qc.type.${c.type.replace('urn:entity:', '')}` as Parameters<typeof t>[0])}: </span>
                {c.entities.slice(0, 3).map((e) => e.name).join(' · ')}
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** Every person Qloo proposed, the checks run (with source links), and the pending ones. */
function DiscoveryDetails({ result, show }: { result: RecommendResult; show: ShowSummary }) {
  const { lang, t } = useI18n();
  return (
    <div className="card p-5 text-sm">
      {result.qlooProposals.length > 0 && (
        <details className="">
          <summary className="cursor-pointer text-stone-300">{t('disc.all', { n: result.qlooProposals.length })}</summary>
          <ul className="mt-2 space-y-2">
            {result.qlooProposals.map((p) => (
              <li key={p.qlooEntityId} className="rounded-lg border border-white/10 p-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{p.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${p.outcome === 'ranked' ? 'bg-emerald-400/10 text-emerald-300' : p.outcome === 'pending' ? 'bg-fuchsia-500/15 text-fuchsia-200' : 'bg-white/10 text-stone-400'}`}>
                    {t(`disc.outcome.${p.outcome}` as Parameters<typeof t>[0])} · {lang === 'es' ? p.reasonEs : p.reason}
                  </span>
                </div>
                <p className="text-[11px] text-stone-500">{t('disc.rank', { n: p.qlooRank })} · {t('disc.signal', { s: p.signal })}</p>
                {p.external && p.external.sources.length > 0 && (
                  <p className="mt-1 text-[11px]">
                    {p.external.sources.map((s) => (
                      <a key={s.url} className="mr-3 text-brass-300 hover:underline" href={s.url} target="_blank" rel="noreferrer">{s.name}</a>
                    ))}
                  </p>
                )}
                <ul className="mt-1 space-y-0.5 text-xs text-stone-400">
                  {p.checks.map((ch) => (
                    <li key={ch.check + ch.detail}>
                      <span className="mr-1 font-mono">{CHECK_ICON(ch.ok)}</span>
                      {t(`check.${ch.check}` as Parameters<typeof t>[0])}: {lang === 'es' ? ch.detailEs : ch.detail}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
      {result.discoveries.length > 0 && (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-widest text-stone-500">{t('disc.pendingTitle')}</p>
          <ul className="mt-2 space-y-2">
            {result.discoveries.map((d) => (
              <li key={d.qlooEntityId} className="rounded-lg border border-white/10 p-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{d.name}</span>
                  <span className="text-xs text-stone-500">{t('disc.rank', { n: d.qlooRank })}{d.popularity !== undefined ? ` · ${t('disc.popularity', { p: Math.round(d.popularity * 100) })}` : ''}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]"><StatusChips rec={d} show={show} /></div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The five picks as large portraits: the answer comes first, the analysis below. */
function GuestLineup({ result, show }: { result: RecommendResult; show: ShowSummary }) {
  const { lang, t } = useI18n();
  const jump = (key: string) => document.getElementById(`rec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="font-display text-4xl sm:text-5xl">{t('recs.title')}</h3>
          <p className="mt-1 text-sm text-stone-400">{t('lineup.lead', { show: show.name })}</p>
        </div>
        <span className="text-xs text-stone-500">{t('recs.meta', { n: result.pastGuestCount, date: result.asOf.slice(0, 10) })}</span>
      </div>
      <ol className="-mx-4 mt-5 flex snap-x gap-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
        {result.recommendations.map((r) => {
          const affinity = r.qlooAudience?.affinity ?? null;
          return (
            <li key={r.key} className="w-44 shrink-0 snap-start lg:w-auto">
              <button onClick={() => jump(r.key)} className="group block w-full text-left" aria-label={`${r.name} · ${t('lineup.jump')}`}>
                <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/10 transition group-hover:ring-brass-400/60">
                  <Portrait name={r.name} profile={result.profiles[r.key]} />
                  <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/70 to-transparent" />
                  <span className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-brass-400 font-display text-lg text-stage-950 shadow">{r.rank}</span>
                  <span className="absolute right-3 top-3 rounded-full bg-black/70 px-2 py-0.5 text-sm font-semibold tabular-nums text-stone-100" title={t('card.scoreHelp')}>{pct(r.score)}</span>
                  <div className="absolute inset-x-0 bottom-0 p-3">
                    <p className="text-lg font-semibold leading-tight text-white">{r.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-stone-300">{audienceSubtitle(r, lang) ?? ''}</p>
                    {affinity !== null && <span className="mt-2 inline-block rounded-full bg-emerald-400/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">{t('lineup.qloo', { n: Math.round(affinity * 100) })}</span>}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A tall photo when a free-licensed one exists, otherwise a large monogram. */
function Portrait({ name, profile }: { name: string; profile: GuestProfile | null | undefined }) {
  const [failed, setFailed] = useState(false);
  const photo = profile?.photo;
  if (photo && !failed) {
    return <img src={photo.thumbUrl} alt={name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="aspect-[4/5] w-full object-cover object-top" />;
  }
  return (
    <div className="flex aspect-[4/5] w-full items-start justify-center bg-gradient-to-br from-stage-600 via-stage-800 to-black pt-[18%] lg:pt-[22%]">
      <span className="font-display text-5xl text-brass-300/90 lg:text-7xl">{initials(name)}</span>
    </div>
  );
}

/** Qloo's age and gender affinity for the show's audience signal, as diverging bars. */
function AudienceChart({ result }: { result: RecommendResult }) {
  const { lang, t } = useI18n();
  const d = result.audienceDemographics?.demographics;
  if (!d) return null;
  const rows: Array<{ label: string; v: number; gap?: boolean }> = [
    ...Object.keys(AGE_LABEL).filter((k) => d.age[k] !== undefined).map((k) => ({ label: AGE_LABEL[k][lang], v: d.age[k] })),
    ...(d.gender.male !== undefined ? [{ label: t('aud.men'), v: d.gender.male, gap: true }] : []),
    ...(d.gender.female !== undefined ? [{ label: t('aud.women'), v: d.gender.female }] : []),
  ];
  if (!rows.length) return null;
  const max = Math.max(0.25, ...rows.map((r) => Math.abs(r.v)));
  const summary = demographicSummary(d, lang);
  return (
    <div className="card border border-emerald-400/30 bg-emerald-500/5 p-5">
      <h3 className="flex flex-wrap items-center gap-2 font-display text-2xl">
        {t('aud.title')} <span className="text-base text-emerald-300/80">{t('aud.by')}</span> <Badge p="LIVE" />
      </h3>
      {summary && <p className="mt-1 text-lg text-stone-100">{summary}</p>}
      <div className="mt-4 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className={`grid grid-cols-[5.5rem_1fr] items-center gap-3 text-xs ${r.gap ? 'pt-3' : ''}`}>
            <span className="text-stone-300">{r.label}</span>
            <div className="relative h-4">
              <div className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
              <div
                className={`absolute inset-y-0.5 rounded-sm ${r.v >= 0 ? 'bg-emerald-400' : 'bg-stone-600'}`}
                style={r.v >= 0 ? { left: '50%', width: `${(r.v / max) * 50}%` } : { right: '50%', width: `${(-r.v / max) * 50}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-stone-500">{t('aud.legend')} {t('qc.audienceNote')}</p>
    </div>
  );
}

export function RecommendView({ show, result, banner }: { show: ShowSummary; result: RecommendResult; banner?: ReactNode }) {
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
    <div className="space-y-8">
    <GuestLineup result={result} show={show} />
    {banner}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="order-2 space-y-6 lg:order-1">
        <AudienceChart result={result} />
        <details className="card group p-5">
          <summary className="cursor-pointer list-none">
            <span className="mr-1 inline-block transition group-open:rotate-90">›</span>
            <span className="font-display text-2xl">{t('trace.collapsed', { n: result.trace.length })}</span>
          </summary>
          <p className="mt-2 text-[11px] text-stone-500">{t('trace.replay')}</p>
          <p className="mt-2 text-xs text-stone-500">{t('trace.planner')}</p>
          <div className="mt-4">
            <AgentTrace steps={result.trace.slice(0, visible)} done={done} />
          </div>
        </details>

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

        {!weakQlooCoverage(result) && (
        <div className="card p-5">
          <h3 className="flex items-center gap-2 font-display text-2xl">{t('affinities.title')} <Badge p={result.qlooMode === 'LIVE' ? 'LIVE' : 'MOCK'} /></h3>
          {recognizableHooks(result).length ? (
            <div className="mt-3 space-y-3">
              {recognizableHooks(result).map((c) => (
                <div key={c.type}>
                  <p className="text-xs uppercase tracking-widest text-stone-500">{c.type.replace('urn:entity:', '')}</p>
                  <div className="mt-1 flex flex-wrap gap-2">{c.entities.map((e) => <span key={e.entityId} className="rounded-full bg-brass-400/10 px-3 py-1 text-xs text-brass-300">{e.name}</span>)}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-stone-400">{t('affinities.pending')}</p>
          )}
          {result.qlooMode === 'LIVE' && <p className="mt-3 text-[11px] text-stone-500">{t('pl.audience')}</p>}
        </div>
        )}
      </section>

      <section className="order-1 space-y-4 lg:order-2">
        {result.qlooMode === 'MOCK' && <div className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-200">{t('recs.mock')}</div>}
        {result.recommendations.map((r) => <RecommendationCard key={r.key} rec={r} show={show} result={result} />)}
        <QlooContribution result={result} />
        <AnalysisSummary result={result} show={show} />
        <DiscoveryPanel result={result} show={show} part="head" />
        {warnings.length > 0 && (
          <details className="rounded-xl border border-brass-400/30 bg-brass-400/10 px-4 py-3 text-sm text-brass-300">
            <summary className="cursor-pointer">{t('recs.warnings', { n: warnings.length })}</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </details>
        )}
        <DiscoveryPanel result={result} show={show} part="details" />
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
    </div>
  );
}
