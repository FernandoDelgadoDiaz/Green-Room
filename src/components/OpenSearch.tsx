import { useState } from 'react';
import { api, type PodcastHit, type ResolveResult } from '../api';
import { useI18n } from '../i18n';

/** Search beyond the catalog: by name (Apple Podcasts directory) or by link (Apple, Spotify, YouTube, RSS). */
export function OpenSearch({ store, onAnalyze }: { store: string | null; onAnalyze: (hit: PodcastHit) => void }) {
  const { lang, t } = useI18n();
  const [mode, setMode] = useState<'name' | 'link'>('name');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<PodcastHit[] | null>(null);
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const run = async () => {
    const v = text.trim();
    if (!v) return;
    setBusy(true);
    setError(null);
    setHits(null);
    setResolved(null);
    try {
      if (mode === 'name') setHits((await api.searchPodcasts(v, store && store !== 'unverified' ? store : undefined)).hits);
      else {
        const r = await api.resolveLink(v);
        setResolved(r);
        setHits(r.hits);
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-2 text-xs uppercase tracking-widest text-stone-500">{t('os.title')}</p>
        {(['name', 'link'] as const).map((m) => (
          <button key={m} aria-pressed={mode === m} onClick={() => (setMode(m), setHits(null), setResolved(null))} className={`rounded-full border px-3 py-1 text-xs ${mode === m ? 'border-brass-400 bg-brass-400 text-stage-950' : 'border-white/15 text-stone-300'}`}>
            {t(`os.mode.${m}`)}
          </button>
        ))}
      </div>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => (e.preventDefault(), void run())}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t(mode === 'name' ? 'os.placeholder.name' : 'os.placeholder.link')}
          aria-label={t(mode === 'name' ? 'os.placeholder.name' : 'os.placeholder.link')}
          className="min-w-0 flex-1 rounded-full border border-white/15 bg-black/30 px-4 py-2 text-sm"
          maxLength={mode === 'link' ? 500 : 100}
        />
        <button className="btn-primary" disabled={busy}>{busy ? '…' : t('os.go')}</button>
      </form>
      <p className="text-[11px] text-stone-500">{t(mode === 'name' ? 'os.note.name' : 'os.note.link')}</p>
      {error && <p className="text-sm text-red-300">{error}</p>}
      {resolved && <p className="text-sm text-stone-300">{lang === 'es' ? resolved.noteEs : resolved.note}</p>}
      {hits && hits.length === 0 && !resolved && <p className="text-sm text-stone-400">{t('os.none')}</p>}
      {hits && hits.length > 0 && (
        <ul className="grid gap-2 md:grid-cols-2">
          {hits.map((h) => (
            <li key={`${h.appleId ?? h.feedUrl}`} className="flex gap-3 rounded-xl border border-white/10 p-3">
              {h.artwork ? <img src={h.artwork} alt="" width={56} height={56} loading="lazy" className="h-14 w-14 shrink-0 rounded-lg bg-white/5 object-cover" /> : <div className="h-14 w-14 shrink-0 rounded-lg bg-white/5" />}
              <div className="min-w-0 flex-1 text-xs">
                <p className="truncate text-sm font-semibold text-stone-100">{h.name}</p>
                <p className="truncate text-stone-400">{h.publisher}</p>
                <p className={h.origin.status === 'verified' ? 'text-emerald-300' : 'text-brass-300'}>
                  {h.origin.status === 'verified' && h.origin.country ? t('os.originVerified', { c: h.origin.country.toUpperCase() }) : t('os.originUnverified')}
                  {h.catalogId && ` · ${t('os.inCatalog')}`}
                </p>
                {h.store && <p className="text-stone-500">{t('os.store', { s: h.store })}</p>}
                <button className="btn-ghost mt-2 disabled:opacity-40" disabled={!h.feedUrl} onClick={() => onAnalyze(h)}>
                  {h.feedUrl ? t('cat.analyze') : t('os.noFeed')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
