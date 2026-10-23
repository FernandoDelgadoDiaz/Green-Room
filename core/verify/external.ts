// External verification of people Qloo proposes, independent of our RSS corpus.
//
// Sources: Wikidata (identity, entity type, occupations, languages spoken) and Wikipedia summaries
// (background text), both public, CC0 / CC BY-SA, read through their documented APIs with a
// descriptive User-Agent. A name match is never proof of identity:
//   - the Qloo record's own Wikidata link (when Qloo provides one) proves the link directly;
//   - otherwise exactly one same-name Wikidata item must share context with Qloo's description or
//     tags, or be the only notable namesake (then the status is only "partial").
// Entity types come from Wikidata P31 ("instance of") and Qloo's own types, not from the name.

import { contextOverlap } from '../profiles';
import { nameKey } from '../names';
import type { QlooEntity } from '../qloo/types';

export type EntityKind = 'person' | 'group' | 'organization' | 'work' | 'ambiguous';
/** documented: identity proven and a Wikipedia article exists; partial: probable identity; pending: not enough evidence; discarded: wrong type or identity. */
export type ExternalStatus = 'documented' | 'partial' | 'pending' | 'discarded';

export interface ExternalSource {
  name: 'Wikidata' | 'Wikipedia' | 'Qloo';
  url: string;
}

export interface ExternalCheck {
  name: string;
  /** Every Qloo id that resolved to this identity (duplicates are merged only by proven identity). */
  qlooIds: string[];
  qlooTypes: string[];
  kind: EntityKind;
  status: ExternalStatus;
  reason: string;
  reasonEs: string;
  wikidataId: string | null;
  sources: ExternalSource[];
  /** What links the Qloo record to this identity. */
  identityEvidence: string[];
  description: { en: string | null; es: string | null };
  occupations: Array<{ en: string; es: string }>;
  /** Text used to place the person in the show's themes (description, occupations, Wikipedia summary). */
  backgroundText: string;
  wikipedia: { lang: 'en' | 'es'; title: string; url: string; extract: string } | null;
  /** Languages spoken (Wikidata P1412) and Wikipedia editions with an article. */
  languages: { spoken: string[]; articles: string[] };
  /** Same-name people found and not chosen. */
  namesakes: Array<{ wikidataId: string; description: string | null }>;
  limitations: string[];
  limitationsEs: string[];
}

export type JsonFetch = (url: string) => Promise<unknown>;

const WD_API = 'https://www.wikidata.org/w/api.php';
const HUMAN = 'Q5';
const DISAMBIGUATION = 'Q4167410';
// Instance-of classes, matched by id first and by their Wikidata label second.
const GROUP_IDS = new Set(['Q215380', 'Q5741069', 'Q9212979', 'Q2088357', 'Q281643', 'Q4438121', 'Q16887380']);
const ORG_IDS = new Set(['Q43229', 'Q4830453', 'Q783794', 'Q891723', 'Q6881511', 'Q1616075']);
const WORK_IDS = new Set(['Q482994', 'Q11424', 'Q5398426', 'Q7366', 'Q7725634', 'Q134556', 'Q17537576', 'Q24862', 'Q169930', 'Q273057']);
const LANG_CODES: Record<string, string> = { Q1860: 'en', Q1321: 'es', Q150: 'fr', Q188: 'de', Q652: 'it', Q5146: 'pt', Q7737: 'ru', Q7850: 'zh', Q5287: 'ja' };

interface WdEntity {
  id: string;
  missing?: string;
  descriptions?: Record<string, { value: string }>;
  labels?: Record<string, { value: string }>;
  sitelinks?: Record<string, { title: string }>;
  claims?: Record<string, Array<{ mainsnak: { datavalue?: { value: unknown } } }>>;
}

const claimIds = (e: WdEntity, p: string) =>
  (e.claims?.[p] ?? []).map((c) => c.mainsnak.datavalue?.value).map((v) => (v && typeof v === 'object' ? (v as { id?: string }).id : undefined)).filter((x): x is string => Boolean(x));

function kindOf(types: string[], typeLabels: Map<string, string>, qlooTypes: string[]): EntityKind {
  if (types.includes(HUMAN)) return 'person';
  const label = (q: string) => (typeLabels.get(q) ?? '').toLowerCase();
  if (types.some((q) => GROUP_IDS.has(q) || /\b(band|musical group|duo|trio|ensemble|collective)\b/.test(label(q)))) return 'group';
  if (types.some((q) => ORG_IDS.has(q) || /\b(company|organization|organisation|institution|business|enterprise|agency)\b/.test(label(q)))) return 'organization';
  if (types.some((q) => WORK_IDS.has(q) || /\b(album|film|song|single|series|book|novel|work|episode)\b/.test(label(q)))) return 'work';
  if (!types.length && qlooTypes.length && !qlooTypes.includes('urn:entity:person')) return 'ambiguous';
  return 'ambiguous';
}

export interface WikidataVerifierOptions {
  fetchJson: JsonFetch;
  /** Maximum Qloo proposals checked per run (by Qloo rank). */
  maxCandidates?: number;
}

/** Verifies Qloo proposals against Wikidata and Wikipedia. All network access goes through `fetchJson`. */
export class WikidataVerifier {
  readonly calls: string[] = [];
  constructor(private readonly opts: WikidataVerifierOptions) {}

  private async get(url: string): Promise<unknown> {
    this.calls.push(url);
    return this.opts.fetchJson(url);
  }

  async verify(proposals: Array<{ entity: QlooEntity }>, ctx: { targetLang: string }): Promise<ExternalCheck[]> {
    const items = proposals.slice(0, this.opts.maxCandidates ?? 12);
    // 1. Candidate Wikidata items: Qloo's own link when present, else same-name search (en + es).
    const candidatesByProposal = await Promise.all(
      items.map(async ({ entity }) => {
        if (entity.wikidataIds?.length) return { linked: true, ids: entity.wikidataIds };
        const ids = new Set<string>();
        for (const lang of ['en', 'es']) {
          const url = `${WD_API}?action=wbsearchentities&format=json&type=item&limit=7&language=${lang}&uselang=${lang}&search=${encodeURIComponent(entity.name)}`;
          const res = (await this.get(url).catch(() => null)) as { search?: Array<{ id: string; label?: string; match?: { text?: string }; description?: string }> } | null;
          for (const s of res?.search ?? []) {
            if (/disambiguation page/i.test(s.description ?? '')) continue;
            if (nameKey(s.label ?? '') === nameKey(entity.name) || nameKey(s.match?.text ?? '') === nameKey(entity.name)) ids.add(s.id);
          }
        }
        return { linked: false, ids: [...ids] };
      }),
    );
    // 2. One batched entity fetch, then one batched label fetch for types, occupations and languages.
    const allIds = [...new Set(candidatesByProposal.flatMap((c) => c.ids))].slice(0, 50);
    const entities = new Map<string, WdEntity>();
    if (allIds.length) {
      const res = (await this.get(`${WD_API}?action=wbgetentities&format=json&props=descriptions|claims|sitelinks&languages=en|es&sitefilter=enwiki|eswiki&ids=${allIds.join('|')}`).catch(() => null)) as { entities?: Record<string, WdEntity> } | null;
      for (const [id, e] of Object.entries(res?.entities ?? {})) if (!e.missing) entities.set(id, e);
    }
    const refIds = [...new Set([...entities.values()].flatMap((e) => [...claimIds(e, 'P31'), ...claimIds(e, 'P106')]))].filter((q) => q !== HUMAN).slice(0, 50);
    const labels = new Map<string, { en: string; es: string }>();
    if (refIds.length) {
      const res = (await this.get(`${WD_API}?action=wbgetentities&format=json&props=labels&languages=en|es&ids=${refIds.join('|')}`).catch(() => null)) as { entities?: Record<string, WdEntity> } | null;
      for (const [id, e] of Object.entries(res?.entities ?? {})) labels.set(id, { en: e.labels?.en?.value ?? id, es: e.labels?.es?.value ?? e.labels?.en?.value ?? id });
    }
    const typeLabels = new Map([...labels].map(([k, v]) => [k, v.en]));

    // 3. Decide identity per proposal.
    const checks: ExternalCheck[] = [];
    for (let i = 0; i < items.length; i++) {
      const { entity } = items[i];
      const cand = candidatesByProposal[i];
      const qlooText = [entity.description ?? '', ...(entity.tags ?? [])].join(' ');
      const qlooTypes = entity.types ?? (entity.type ? [entity.type] : []);
      const found = cand.ids.map((id) => entities.get(id)).filter((e): e is WdEntity => Boolean(e) && !claimIds(e!, 'P31').includes(DISAMBIGUATION));
      const text = (e: WdEntity) => [e.descriptions?.en?.value, e.descriptions?.es?.value, ...claimIds(e, 'P106').flatMap((o) => [labels.get(o)?.en, labels.get(o)?.es])].filter(Boolean).join(' ');
      const base = (e: WdEntity | null, kind: EntityKind): ExternalCheck => ({
        name: entity.name,
        qlooIds: [entity.entityId],
        qlooTypes,
        kind,
        status: 'pending',
        reason: '',
        reasonEs: '',
        wikidataId: e?.id ?? null,
        sources: e ? [{ name: 'Wikidata', url: `https://www.wikidata.org/wiki/${e.id}` }] : [],
        identityEvidence: [],
        description: { en: e?.descriptions?.en?.value ?? null, es: e?.descriptions?.es?.value ?? null },
        occupations: e ? claimIds(e, 'P106').map((o) => labels.get(o)).filter((x): x is { en: string; es: string } => Boolean(x)) : [],
        backgroundText: e ? text(e) : '',
        wikipedia: null,
        languages: { spoken: e ? claimIds(e, 'P1412').map((q) => LANG_CODES[q]).filter(Boolean) : [], articles: e ? Object.keys(e.sitelinks ?? {}).map((s) => s.replace('wiki', '')) : [] },
        namesakes: [],
        limitations: [],
        limitationsEs: [],
      });
      const setStatus = (c: ExternalCheck, s: ExternalStatus, en: string, es: string) => Object.assign(c, { status: s, reason: en, reasonEs: es });

      if (!found.length) {
        const c = base(null, 'ambiguous');
        checks.push(setStatus(c, 'pending', 'No Wikidata record with this exact name: not enough evidence.', 'Ningún registro de Wikidata con este nombre exacto: evidencia insuficiente.'));
        continue;
      }
      const kinds = new Map(found.map((e) => [e.id, kindOf(claimIds(e, 'P31'), typeLabels, qlooTypes)]));
      const humans = found.filter((e) => kinds.get(e.id) === 'person');
      if (cand.linked && found.length === 1) {
        // Qloo's own Wikidata link: identity proven by the link itself.
        const e = found[0];
        const c = base(e, kinds.get(e.id)!);
        c.identityEvidence.push(`Qloo record links to Wikidata ${e.id}`);
        if (c.kind !== 'person') checks.push(setStatus(c, 'discarded', `Not an individual person: Wikidata lists it as a ${c.kind}.`, `No es una persona individual: Wikidata lo registra como ${KIND_ES[c.kind]}.`));
        else checks.push(setStatus(c, Object.keys(e.sitelinks ?? {}).length ? 'documented' : 'partial', 'Identity linked by Qloo to Wikidata.', 'Identidad vinculada por Qloo a Wikidata.'));
        continue;
      }
      if (!humans.length) {
        // Same name, but only bands, companies or works: a type error, not a person to invite.
        const e = found[0];
        const c = base(e, kinds.get(e.id)!);
        c.identityEvidence.push(`Exact name match; Wikidata type: ${claimIds(e, 'P31').map((q) => typeLabels.get(q) ?? q).join(', ')}`);
        checks.push(setStatus(c, 'discarded', `Not an individual person: Wikidata lists “${entity.name}” as a ${c.kind}${c.kind === 'group' ? ' (band, duo or collective)' : ''}.`, `No es una persona individual: Wikidata registra a “${entity.name}” como ${KIND_ES[c.kind]}.`));
        continue;
      }
      // Disambiguate humans: shared context with Qloo's own description and tags.
      const scored = humans.map((e) => ({ e, overlap: qlooText.trim() ? contextOverlap(entity.name, text(e), [qlooText]) : [] }));
      const withContext = scored.filter((s) => s.overlap.length > 0).sort((a, b) => b.overlap.length - a.overlap.length);
      const notable = humans.filter((e) => Object.keys(e.sitelinks ?? {}).length > 0);
      let chosen: WdEntity | null = null;
      let byNotabilityOnly = false;
      // The best context match wins only if it is strictly better than the next namesake.
      if (withContext.length === 1 || (withContext.length > 1 && withContext[0].overlap.length > withContext[1].overlap.length)) chosen = withContext[0].e;
      else if (!withContext.length && humans.length === 1) ((chosen = humans[0]), (byNotabilityOnly = true));
      else if (!withContext.length && notable.length === 1) ((chosen = notable[0]), (byNotabilityOnly = true));
      if (!chosen) {
        const c = base(null, 'person');
        c.namesakes = humans.map((e) => ({ wikidataId: e.id, description: e.descriptions?.en?.value ?? e.descriptions?.es?.value ?? null }));
        checks.push(setStatus(c, 'pending', `${humans.length} people named “${entity.name}” in Wikidata and nothing in Qloo’s data tells them apart: not merged.`, `${humans.length} personas llamadas “${entity.name}” en Wikidata y nada en los datos de Qloo permite distinguirlas: no se fusionan.`));
        continue;
      }
      const c = base(chosen, 'person');
      c.namesakes = humans.filter((e) => e !== chosen).map((e) => ({ wikidataId: e.id, description: e.descriptions?.en?.value ?? e.descriptions?.es?.value ?? null }));
      const overlap = scored.find((s) => s.e === chosen)!.overlap;
      if (overlap.length) c.identityEvidence.push(`Qloo’s description/tags and Wikidata share: ${overlap.slice(0, 5).join(', ')}`);
      if (byNotabilityOnly)
        c.identityEvidence.push(c.namesakes.length ? `Only namesake with a Wikipedia article (${c.namesakes.length} other(s) without one)` : 'Only person with this exact name in Wikidata');
      const hasArticle = Object.keys(chosen.sitelinks ?? {}).length > 0;
      if (!byNotabilityOnly && hasArticle) setStatus(c, 'documented', 'Identity documented: Wikidata record with Wikipedia article, linked to Qloo’s data by shared context.', 'Identidad documentada: registro de Wikidata con artículo en Wikipedia, vinculado a los datos de Qloo por contexto compartido.');
      else
        setStatus(
          c,
          'partial',
          byNotabilityOnly ? 'Partially verified: same name, chosen as the only notable match; Qloo gave no context to confirm it.' : 'Partially verified: context matches, but no Wikipedia article to document the background.',
          byNotabilityOnly ? 'Verificado parcialmente: mismo nombre, elegido por ser la única coincidencia notable; Qloo no dio contexto para confirmarlo.' : 'Verificado parcialmente: el contexto coincide, pero no hay artículo de Wikipedia que documente la trayectoria.',
        );
      checks.push(c);
    }

    // 4. Wikipedia summaries for the people we kept (target language first).
    const prefer = ctx.targetLang === 'es' ? ['es', 'en'] : ['en', 'es'];
    await Promise.all(
      checks
        .filter((c) => c.kind === 'person' && (c.status === 'documented' || c.status === 'partial') && c.wikidataId)
        .map(async (c) => {
          const e = entities.get(c.wikidataId!)!;
          const lang = prefer.find((l) => e.sitelinks?.[`${l}wiki`]) as 'en' | 'es' | undefined;
          if (!lang) return;
          const title = e.sitelinks![`${lang}wiki`].title;
          const res = (await this.get(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`).catch(() => null)) as {
            extract?: string;
            wikibase_item?: string;
            content_urls?: { desktop?: { page?: string } };
          } | null;
          // The summary must point back to the same Wikidata item.
          if (!res?.extract || res.wikibase_item !== c.wikidataId) return;
          const url = res.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`;
          c.wikipedia = { lang, title, url, extract: res.extract };
          c.sources.push({ name: 'Wikipedia', url });
          c.backgroundText = `${c.backgroundText} ${res.extract}`;
        }),
    );

    // 5. Duplicates: Qloo ids that resolved to the same Wikidata item are one person (ids kept).
    const merged: ExternalCheck[] = [];
    for (const c of checks) {
      const same = c.wikidataId && c.kind === 'person' ? merged.find((m) => m.wikidataId === c.wikidataId && m.kind === 'person') : null;
      if (same) {
        same.qlooIds.push(...c.qlooIds.filter((x) => !same.qlooIds.includes(x)));
        same.identityEvidence.push(`Qloo id ${c.qlooIds[0]} resolves to the same Wikidata item ${c.wikidataId}`);
      } else merged.push(c);
    }
    for (const c of merged) {
      c.limitations.push('No interviews in our RSS sources: activity and recency are not measured (never imputed).');
      c.limitationsEs.push('Sin entrevistas en nuestras fuentes RSS: actividad y recencia no se miden (nunca se imputan).');
      if (!c.languages.spoken.length) {
        c.limitations.push('Languages spoken are not recorded in Wikidata.');
        c.limitationsEs.push('Wikidata no registra los idiomas que habla.');
      }
    }
    return merged;
  }
}

const KIND_ES: Record<EntityKind, string> = { person: 'persona', group: 'grupo (banda, dúo o colectivo)', organization: 'organización', work: 'obra', ambiguous: 'entidad ambigua' };
