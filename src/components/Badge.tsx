import type { Provenance } from '../../core/types';

const STYLES: Record<Provenance | 'OFF', string> = {
  VERIFIED: 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30',
  INFERRED: 'bg-sky-400/15 text-sky-300 ring-sky-400/30',
  MOCK: 'bg-fuchsia-500/20 text-fuchsia-200 ring-fuchsia-400/40',
  LIVE: 'bg-brass-400/20 text-brass-300 ring-brass-400/40',
  OFF: 'bg-white/10 text-stone-300 ring-white/20',
};

export const PROVENANCE_HELP: Record<Provenance, string> = {
  VERIFIED: 'Read directly from the show’s public RSS feed (title, date, link).',
  INFERRED: 'Derived by Green Room’s own transparent rules from verified data.',
  MOCK: 'Simulated stand-in for Qloo while we wait for the API key. Not evidence.',
  LIVE: 'Returned by the real Qloo hackathon API.',
};

export function Badge({ p, className = '' }: { p: Provenance | 'OFF'; className?: string }) {
  return (
    <span
      title={p === 'OFF' ? 'Qloo disabled' : PROVENANCE_HELP[p]}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ring-1 ${STYLES[p]} ${className}`}
    >
      {p}
    </span>
  );
}
