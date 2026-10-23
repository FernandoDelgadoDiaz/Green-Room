import { useMemo, useState } from 'react';
import type { Catalog, CatalogShow, PodcastHit } from '../api';
import { OpenSearch } from './OpenSearch';
import { useI18n } from '../i18n';
import { showsFromCountry, unclassifiedShows } from '../../core/catalog';

export const COUNTRIES = [
  { code: 'us', flag: '🇺🇸', en: 'United States', es: 'Estados Unidos', lang: 'EN' },
  { code: 'mx', flag: '🇲🇽', en: 'Mexico', es: 'México', lang: 'ES' },
  { code: 'gb', flag: '🇬🇧', en: 'United Kingdom', es: 'Reino Unido', lang: 'EN' },
  { code: 'ar', flag: '🇦🇷', en: 'Argentina', es: 'Argentina', lang: 'ES' },
  { code: 'es', flag: '🇪🇸', en: 'Spain', es: 'España', lang: 'ES' },
] as const;

const UNVERIFIED = 'unverified';

const countryName = (code: string, lang: 'en' | 'es') => COUNTRIES.find((c) => c.code === code)?.[lang] ?? code.toUpperCase();

/** Official Apple artwork; if it cannot load, show the show's initials instead of a broken image. */
function Artwork({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return failed ? (
    <div aria-hidden className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brass-400/30 to-emerald-900/40 font-display text-2xl text-brass-300">{initials}</div>
  ) : (
    <img src={src} alt="" loading="lazy" width={72} height={72} onError={() => setFailed(true)} className="h-[72px] w-[72px] shrink-0 rounded-lg bg-white/5 object-cover" />
  );
}

function StatusBadge({ s }: { s: CatalogShow }) {
  const { t } = useI18n();
  const tone = s.status === 'analyzable' ? 'bg-emerald-400/10 text-emerald-300' : s.status === 'limited' ? 'bg-brass-400/10 text-brass-300' : 'bg-white/10 text-stone-400';
  return <span className={`rounded-full px-2.5 py-1 text-[11px] ${tone}`}>{t(`cat.status.${s.status}${s.statusReason ? `.${s.statusReason}` : ''}` as Parameters<typeof t>[0])}</span>;
}

/** Where the show is made, with the source that says so (or why it is not classified). */
function OriginLine({ s }: { s: CatalogShow }) {
  const { lang, t } = useI18n();
  const o = s.origin;
  const ev = o.evidence[0];
  return (
    <details className="mt-2 text-xs">
      <summary className={`cursor-pointer ${o.status === 'verified' ? 'text-emerald-300' : 'text-brass-300'}`}>
        {o.status === 'verified' && o.country
          ? t('cat.originVerified', { country: countryName(o.country, lang), basis: t(`cat.basis.${o.basis}` as Parameters<typeof t>[0]) })
          : t('cat.originUnverified')}
      </summary>
      <div className="mt-1 space-y-1 border-l border-white/10 pl-2 text-stone-400">
        {ev && (
          <p>
            “{ev.quote}” —{' '}
            <a className="text-brass-300 hover:underline" href={ev.url} target="_blank" rel="noreferrer">
              {new URL(ev.url).hostname}
            </a>
          </p>
        )}
        {'note' in o && o.note && <p className="text-stone-500">{o.note}</p>}
      </div>
    </details>
  );
}

function ShowCard({ s, onSelect, selected }: { s: CatalogShow; onSelect: (id: string) => void; selected: boolean }) {
  const { lang, t } = useI18n();
  const disabled = s.status === 'not_analyzable';
  const ranks = s.charts.filter((c) => c.rank);
  return (
    <article className={`card flex flex-col p-4 ${selected ? 'border-brass-400/70 ring-1 ring-brass-400/40' : ''}`}>
      <div className="flex gap-3">
        <Artwork src={s.artwork} name={s.name} />
        <div className="min-w-0">
          <h3 className="font-display text-xl leading-tight">{s.name}</h3>
          <p className="text-sm text-stone-400">{s.host}</p>
          <p className="mt-1 text-[11px] uppercase tracking-widest text-stone-500">{s.genre} · {s.language.toUpperCase()}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1 text-xs text-stone-400">
        <li>
          {ranks.length ? t('cat.popularity', { ranks: ranks.map((c) => `#${c.rank} ${countryName(c.country, lang)}`).join(' · ') }) : t('cat.noChart')}
        </li>
        <li>{t('cat.lastEpisode', { date: s.lastRelease.slice(0, 10) })} · {t('cat.appleCount', { n: s.appleTrackCount })}</li>
        {s.snapshot && <li>{t('cat.snapshot', { n: s.snapshot.episodes, c: Math.round(s.snapshot.coverage * 100) })}</li>}
      </ul>
      <OriginLine s={s} />
      {s.description && <p className="mt-2 line-clamp-2 text-xs text-stone-500">{s.description}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge s={s} />
        <a className="text-[11px] text-brass-300 hover:underline" href={s.appleUrl} target="_blank" rel="noreferrer">Apple Podcasts</a>
        <a className="text-[11px] text-brass-300 hover:underline" href={s.feedUrl} target="_blank" rel="noreferrer">RSS</a>
      </div>
      <button className="btn-primary mt-4 self-start disabled:cursor-not-allowed disabled:opacity-40" disabled={disabled} onClick={() => onSelect(s.id)}>
        {disabled ? t('cat.notAnalyzableBtn') : t('cat.analyze')}
      </button>
    </article>
  );
}

const STATUS_ORDER: Record<string, number> = { analyzable: 0, limited: 1, not_analyzable: 2 };

export function CatalogPicker({ catalog, selected, onSelect, onAnalyzeHit }: { catalog: Catalog; selected: string | null; onSelect: (id: string) => void; onAnalyzeHit: (hit: PodcastHit) => void }) {
  const { lang, t } = useI18n();
  const [country, setCountry] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shows = useMemo(
    () =>
      (q ? catalog.shows.filter((s) => `${s.name} ${s.host}`.toLowerCase().includes(q)) : country === UNVERIFIED ? unclassifiedShows(catalog.shows) : country ? showsFromCountry(catalog.shows, country) : [])
        // Analyzable first; popularity never decides membership, only the order within a status.
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.charts[0]?.rank ?? 99) - (b.charts[0]?.rank ?? 99)),
    [catalog, country, q],
  );
  const unverifiedCount = unclassifiedShows(catalog.shows).length;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-3 text-xs uppercase tracking-widest text-stone-500">{t('cat.step1')}</h2>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('cat.step1')}>
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              onClick={() => (setCountry(c.code), setQuery(''))}
              aria-pressed={country === c.code}
              className={`rounded-full border px-4 py-2 text-sm transition ${country === c.code ? 'border-brass-400 bg-brass-400 text-stage-950' : 'border-white/15 text-stone-200 hover:bg-white/5'}`}
            >
              <span aria-hidden className="mr-1.5">{c.flag}</span>
              {c[lang]} <span className="ml-1 text-[10px] opacity-70">{c.lang}</span>
            </button>
          ))}
          {unverifiedCount > 0 && (
            <button
              onClick={() => (setCountry(UNVERIFIED), setQuery(''))}
              aria-pressed={country === UNVERIFIED}
              className={`rounded-full border border-dashed px-4 py-2 text-sm transition ${country === UNVERIFIED ? 'border-brass-400 bg-brass-400 text-stage-950' : 'border-white/15 text-stone-400 hover:bg-white/5'}`}
            >
              {t('cat.unverifiedChip', { n: unverifiedCount })}
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xs uppercase tracking-widest text-stone-500">{t('cat.step2')}</h2>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('cat.search')}
          aria-label={t('cat.search')}
          className="w-full rounded-full border border-white/15 bg-black/30 px-4 py-2 text-sm sm:w-72"
        />
      </div>
      {country && country !== UNVERIFIED && !q && <p className="text-xs text-stone-500">{t('cat.sourceNote', { country: countryName(country, lang), date: catalog.originCheckedAt })}</p>}
      {country === UNVERIFIED && !q && <p className="text-xs text-stone-500">{t('cat.unverifiedNote')}</p>}
      {!country && !q && <p className="text-sm text-stone-400">{t('cat.pickCountry')}</p>}
      {(country || q) && shows.length === 0 && <p className="text-sm text-stone-400">{t('cat.noResults')}</p>}
      <OpenSearch store={country} onAnalyze={(h) => (h.catalogId ? onSelect(h.catalogId) : onAnalyzeHit(h))} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shows.map((s) => (
          <ShowCard key={s.id} s={s} onSelect={onSelect} selected={selected === s.id} />
        ))}
      </div>
    </div>
  );
}
