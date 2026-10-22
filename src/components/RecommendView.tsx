import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentResult, Recommendation, TraceStep } from '../../core/agent/agent';
import { draftProposal } from '../../core/pitch';
import type { ShowSummary } from '../api';
import { Badge } from './Badge';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}`);

export function AgentTrace({ steps, done }: { steps: TraceStep[]; done: boolean }) {
  return (
    <ol className="relative space-y-3 border-l border-white/10 pl-5">
      {steps.map((s, i) => (
        <li key={s.id} className="rise relative" style={{ animationDelay: `${i * 40}ms` }}>
          <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-brass-400" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-stone-100">{s.title}</span>
            {s.tool && <code className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-stone-400">{s.tool}</code>}
            <Badge p={s.provenance} />
          </div>
          <p className="mt-1 text-sm text-stone-400">{s.detail}</p>
          {s.decision && <p className="mt-1 text-sm text-brass-300">→ {s.decision}</p>}
        </li>
      ))}
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

function ProposalModal({ rec, show, result, onClose }: { rec: Recommendation; show: ShowSummary; result: AgentResult; onClose: () => void }) {
  const proposal = draftProposal(rec, show, result.themes);
  const [copied, setCopied] = useState(false);
  // Portal: ancestors use backdrop-filter, which would otherwise trap a fixed-position overlay.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-2xl overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-brass-400">Interview proposal · draft</p>
            <h3 className="font-display text-3xl">{proposal.subject}</h3>
          </div>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
        <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-black/30 p-4 font-sans text-sm leading-relaxed text-stone-200">{proposal.body}</pre>
        <div className="mt-4 text-xs text-stone-400">
          <p className="font-semibold text-stone-300">Built only from:</p>
          <ul className="mt-1 list-disc pl-5">{proposal.basedOn.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
        <button
          className="btn-primary mt-4"
          onClick={() => {
            navigator.clipboard?.writeText(`${proposal.subject}\n\n${proposal.body}`);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy draft'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

function RecommendationCard({ rec, show, result }: { rec: Recommendation; show: ShowSummary; result: AgentResult }) {
  const [open, setOpen] = useState(false);
  const [pitch, setPitch] = useState(false);
  const c = rec.components;
  return (
    <article className="card rise p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-4xl text-brass-400">{rec.rank}</span>
          <div>
            <h4 className="text-xl font-semibold">{rec.name}</h4>
            <p className="text-xs text-stone-400">
              {rec.source === 'verified-pool' ? `${rec.appearances.length} verified appearance${rec.appearances.length === 1 ? '' : 's'} on comparison shows` : 'Suggested by Qloo person insights'}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums">{pct(rec.score)}</p>
          <p className="text-[10px] uppercase tracking-widest text-stone-500">fit score</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-4">
        {(
          [
            ['Topical fit', c.themeFit, 'bg-sky-400'],
            ['Qloo affinity', c.qlooAffinity, c.qlooAffinity.provenance === 'MOCK' ? 'bg-fuchsia-400' : 'bg-brass-400'],
            ['Momentum', c.momentum, 'bg-emerald-400'],
            ['Recency', c.recency, 'bg-emerald-400'],
          ] as const
        ).map(([label, comp, tone]) => (
          <div key={label} title={comp.explanation}>
            <div className="mb-1 flex items-center justify-between gap-1">
              <span className="text-stone-300">{label}</span>
              <Badge p={comp.provenance} />
            </div>
            <Bar value={comp.value} tone={tone} />
            <p className="mt-1 text-[10px] text-stone-500">
              {pct(comp.value)} · weight {comp.weight}
            </p>
          </div>
        ))}
      </div>

      <ul className="mt-4 space-y-1.5">
        {rec.rationale.map((r) => (
          <li key={r.text} className="flex items-start gap-2 text-sm text-stone-300">
            <Badge p={r.provenance} className="mt-0.5 shrink-0" />
            <span>{r.text}</span>
          </li>
        ))}
      </ul>

      {rec.conversationTopics.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 flex items-center gap-2 text-xs uppercase tracking-widest text-stone-500">
            Possible conversation threads <Badge p="INFERRED" />
          </p>
          <div className="flex flex-wrap gap-2">
            {rec.conversationTopics.map((t) => (
              <span key={t} className="rounded-full bg-white/5 px-3 py-1 text-xs text-stone-200">{t}</span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={() => setOpen(!open)}>{open ? 'Hide evidence' : 'Open evidence'}</button>
        <button className="btn-primary" onClick={() => setPitch(true)}>Draft interview proposal</button>
      </div>

      {open && (
        <div className="mt-4 rounded-xl bg-black/25 p-4">
          <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-stone-500">Sources <Badge p="VERIFIED" /></p>
          <ul className="space-y-2 text-sm">
            {rec.appearances.map((a) => (
              <li key={a.episodeId} className="text-stone-300">
                <span className="text-stone-500">{a.published.slice(0, 10)} · {a.showName} · </span>
                {a.url ? (
                  <a className="text-brass-300 underline-offset-2 hover:underline" href={a.url} target="_blank" rel="noreferrer">{a.title}</a>
                ) : (
                  a.title
                )}
              </li>
            ))}
            {rec.appearances.length === 0 && <li className="text-stone-400">No verified appearance; evidence is Qloo affinity only.</li>}
          </ul>
          {rec.qlooEntityId && (
            <p className="mt-3 text-xs text-stone-500">
              Qloo entity: <code>{rec.qlooEntityId}</code> <Badge p={result.qlooMode === 'LIVE' ? 'LIVE' : 'MOCK'} />
            </p>
          )}
        </div>
      )}
      {pitch && <ProposalModal rec={rec} show={show} result={result} onClose={() => setPitch(false)} />}
    </article>
  );
}

export function RecommendView({ show, result }: { show: ShowSummary; result: AgentResult }) {
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    setVisible(0);
    const id = setInterval(() => setVisible((v) => (v >= result.trace.length ? v : v + 1)), 220);
    return () => clearInterval(id);
  }, [result]);
  const done = visible >= result.trace.length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="space-y-6">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-2xl">What the agent did</h3>
            <span className="text-[11px] text-stone-500">replay of this run’s actual steps</span>
          </div>
          <div className="mt-4">
            <AgentTrace steps={result.trace.slice(0, visible)} done={done} />
          </div>
        </div>

        <div className="card p-5">
          <h3 className="flex items-center gap-2 font-display text-2xl">Themes in the show’s history <Badge p="INFERRED" /></h3>
          <p className="mt-1 text-xs text-stone-400">From {result.historyEpisodeCount} episode titles. Describes what the show talks about, not what listeners like.</p>
          <div className="mt-4 space-y-3">
            {result.themes.map((t) => (
              <div key={t.id}>
                <div className="flex justify-between text-sm"><span>{t.label}</span><span className="tabular-nums text-stone-400">{Math.round(t.share * 100)}%</span></div>
                <Bar value={t.share} tone="bg-sky-400" />
                <p className="mt-1 text-[11px] text-stone-500">{t.words.join(' · ')}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="flex items-center gap-2 font-display text-2xl">Cultural affinities of this audience <Badge p={result.qlooMode === 'LIVE' ? 'LIVE' : 'MOCK'} /></h3>
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
            <p className="mt-2 text-sm text-stone-400">
              Waiting for the live Qloo API. With the key, this panel shows the artists, films and books that people who follow this show’s past guests over-index on. No placeholder names are shown: we do not invent taste data.
            </p>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <h3 className="font-display text-3xl">Five guests to invite next</h3>
          <span className="text-xs text-stone-500">{result.pastGuestCount} past guests excluded · as of {result.asOf.slice(0, 10)}</span>
        </div>
        {result.warnings.map((w) => (
          <div key={w} className="rounded-xl border border-brass-400/30 bg-brass-400/10 px-4 py-3 text-sm text-brass-300">{w}</div>
        ))}
        {result.qlooMode === 'MOCK' && (
          <div className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-200">
            MOCK mode: people, episodes and dates are real (public RSS). Qloo affinity values are simulated, shown in pink, and carry weight 0 in the ranking.
          </div>
        )}
        {result.recommendations.map((r) => <RecommendationCard key={r.key} rec={r} show={show} result={result} />)}
        {result.discarded.length > 0 && (
          <details className="card p-4 text-sm text-stone-300">
            <summary className="cursor-pointer font-semibold">Discarded because they already appeared ({result.discarded.length})</summary>
            <ul className="mt-3 space-y-1">
              {result.discarded.slice(0, 30).map((d) => (
                <li key={d.name + d.reason}>
                  <span className="text-stone-100">{d.name}</span> — {d.reason}
                  {d.evidence?.url && <> · <a className="text-brass-300 hover:underline" href={d.evidence.url} target="_blank" rel="noreferrer">episode</a></>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
