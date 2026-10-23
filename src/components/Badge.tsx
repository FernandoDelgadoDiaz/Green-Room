import type { Provenance } from '../../core/types';
import { useI18n } from '../i18n';

const STYLES: Record<Provenance | 'OFF', string> = {
  VERIFIED: 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30',
  INFERRED: 'bg-sky-400/15 text-sky-300 ring-sky-400/30',
  MOCK: 'bg-fuchsia-500/20 text-fuchsia-200 ring-fuchsia-400/40',
  LIVE: 'bg-brass-400/20 text-brass-300 ring-brass-400/40',
  OFF: 'bg-white/10 text-stone-300 ring-white/20',
};

export function Badge({ p, className = '' }: { p: Provenance | 'OFF'; className?: string }) {
  const { t } = useI18n();
  return (
    <span
      title={p === 'OFF' ? 'Qloo OFF' : t(`prov.${p}`)}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ring-1 ${STYLES[p]} ${className}`}
    >
      {p}
    </span>
  );
}
