// "Why these five", in plain words: what Qloo inferred about the show's audience, why each pick is
// there, and what the agent did. Every sentence comes from a field of the result; nothing is
// claimed when the field is missing. Qloo measures taste and affinity, never "needs".

import type { Recommendation } from '../core/agent/agent';
import type { RecommendResult } from './api';
import { citableThemes, monthYear } from './why';
import { positionLabel, specificPosition } from '../core/positions';

type Lang = 'en' | 'es';

const list = (xs: string[], lang: Lang) => new Intl.ListFormat(lang, { type: 'conjunction' }).format(xs);
const pct = (v: number) => Math.round(v * 100);

/** Qloo entity types as a reader would name them; order: what says most about a talk-show audience first. */
const KIND: Array<[string, { en: string; es: string }]> = [
  ['urn:entity:book', { en: 'Books', es: 'Libros' }],
  ['urn:entity:person', { en: 'People', es: 'Personas' }],
  ['urn:entity:podcast', { en: 'Podcasts', es: 'Podcasts' }],
  ['urn:entity:tv_show', { en: 'TV', es: 'Series' }],
  ['urn:entity:movie', { en: 'Films', es: 'Películas' }],
  ['urn:entity:artist', { en: 'Music', es: 'Música' }],
  ['urn:entity:brand', { en: 'Brands', es: 'Marcas' }],
];

const TALK_KINDS = new Set(['urn:entity:book', 'urn:entity:person', 'urn:entity:podcast', 'urn:entity:tv_show']);

export interface AudienceRead {
  /** "Mostly men, 45–54", or null without a demographic profile. */
  profile: string | null;
  likes: Array<{ label: string; names: string[] }>;
  /** How Qloo got there, for this run's signal. */
  how: string;
}

export interface GuestWhy {
  key: string;
  name: string;
  qloo: string;
  offers: string | null;
  /** "The same kind of guest as …": shown once per block (consecutive picks often share the same pair). */
  kind: string | null;
  timely: string | null;
}

const AGE: Record<string, { en: string; es: string }> = {
  '24_and_younger': { en: 'under 25', es: 'menores de 25' },
  '25_to_29': { en: '25–29', es: 'de 25 a 29' },
  '30_to_34': { en: '30–34', es: 'de 30 a 34' },
  '35_to_44': { en: '35–44', es: 'de 35 a 44' },
  '45_to_54': { en: '45–54', es: 'de 45 a 54' },
  '55_and_older': { en: '55+', es: 'de 55 o más' },
};

export function audienceRead(result: Pick<RecommendResult, 'audienceDemographics' | 'culturalAffinities' | 'signalStrategy' | 'signalDiagnostics' | 'pastGuestCount'>, showName: string, lang: Lang, minPopularity = 0.75): AudienceRead {
  const es = lang === 'es';
  const d = result.audienceDemographics?.demographics;
  let profile: string | null = null;
  if (d) {
    const ages = Object.entries(d.age).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => AGE[k]?.[lang] ?? k);
    const male = d.gender.male ?? 0;
    const gender = Math.abs(male) < 0.05 ? null : male > 0 ? (es ? 'más hombres que mujeres' : 'more men than women') : es ? 'más mujeres que hombres' : 'more women than men';
    const parts = [gender, ages.length ? (es ? `sobre todo ${list(ages, lang)} años` : `mostly aged ${list(ages, lang)}`) : null].filter(Boolean) as string[];
    if (parts.length) profile = parts.join(es ? ', ' : ', ');
  }
  const all = KIND.map(([type, label]) => {
    const c = result.culturalAffinities.find((x) => x.type === type);
    const names = (c?.entities ?? []).filter((e) => (e.popularity ?? 1) >= minPopularity).slice(0, 4).map((e) => e.name);
    return { type, label: label[lang], names };
  }).filter((x) => x.names.length >= 2);
  // Books, people, podcasts and series say most about an interview audience; films and music (whose
  // top titles can drift far from the show) appear only when nothing else came back.
  const talk = all.filter((x) => TALK_KINDS.has(x.type));
  const likes = (talk.length ? talk : all).slice(0, 2).map(({ label, names }) => ({ label, names }));
  const tags = result.signalDiagnostics.tags.map((t) => t.accepted).filter((t): t is string => Boolean(t)).slice(0, 3);
  const g = result.signalDiagnostics.guests;
  const how = (() => {
    switch (result.signalStrategy) {
      case 'guests':
        return es
          ? `Qloo lo deduce de millones de personas que siguen a ${g.confirmed} de los invitados anteriores de ${showName}. No es una encuesta a los oyentes.`
          : `Qloo infers it from millions of people who follow ${g.confirmed} of ${showName}'s past guests. It is not a survey of listeners.`;
      case 'podcast':
        return es ? `Qloo lo deduce de millones de personas que siguen ${showName}. No es una encuesta a los oyentes.` : `Qloo infers it from millions of people who follow ${showName}. It is not a survey of listeners.`;
      case 'podcast+tags':
        return es
          ? `Qloo lo deduce de millones de personas que siguen ${showName}${tags.length ? ` o se interesan por ${list(tags, lang)}` : ''}. No es una encuesta a los oyentes.`
          : `Qloo infers it from millions of people who follow ${showName}${tags.length ? ` or are into ${list(tags, lang)}` : ''}. It is not a survey of listeners.`;
      case 'tags':
        return es
          ? `Qloo casi no conoce a este programa ni a sus invitados: lo deduce solo de quienes se interesan por ${list(tags, lang) || 'sus temas'}. Tomalo como una pista, no como un retrato.`
          : `Qloo barely knows this show or its guests: it infers it only from people into ${list(tags, lang) || 'its topics'}. Read it as a hint, not a portrait.`;
      default:
        return es ? 'Qloo no tiene datos suficientes de este programa.' : 'Qloo does not have enough data on this show.';
    }
  })();
  return { profile, likes, how };
}

export function guestWhy(rec: Recommendation, lang: Lang, now = Date.now(), showName = '', opts: { kindClaims?: boolean } = {}): GuestWhy {
  const es = lang === 'es';
  const q = rec.qlooAudience;
  // The show itself as the only reason says nothing new (shows matched by their own Qloo entity).
  const by = (q?.explainedBy ?? []).filter((n) => n !== showName);
  const qloo =
    q?.affinity === null || q?.affinity === undefined
      ? noAffinity(rec, lang)
      : (es ? `Afinidad con tu público: ${pct(q.affinity)} de 100, comparada con los demás candidatos.` : `Affinity with your audience: ${pct(q.affinity)} out of 100, compared with the other candidates.`) +
        (by.length ? (es ? ` Lo que más pesó: ${list(by, lang)}.` : ` What weighed most: ${list(by, lang)}.`) : '');
  const themes = citableThemes(rec).slice(0, 2).map((s) => (es ? s.labelEs : s.label));
  // Only a position that says of what ("CEO of Anthropic"), as in the invitation letters.
  const pos = specificPosition(rec.audience?.positions);
  const position = pos ? positionLabel(pos, lang, rec.audience) : null;
  // Past guests of the same kind (from each person's description), as in the letters; skipped on older results.
  const a = rec.audience;
  const cat = opts.kindClaims === false ? null : (a?.sharedCategories.find((c) => (a.similarByCategory?.[c] ?? []).length) ?? null);
  const pool = cat ? (a!.similarByCategory![cat] ?? []) : [];
  const similar = pool.slice(0, 2);
  const kind = similar.length
    ? es
      ? `Del mismo tipo de invitado que ${list(similar, lang)}, que ya ${similar.length === 1 ? 'pasó' : 'pasaron'} por el programa.`
      : `The same kind of guest as ${list(similar, lang)}, who ${similar.length === 1 ? 'has' : 'have'} already been on the show.`
    : null;
  const own = [position ? `${position.charAt(0).toUpperCase()}${position.slice(1)}.` : null, themes.length ? (es ? `Habla de temas frecuentes del programa: ${themes.join('; ')}.` : `Talks about frequent topics on the show: ${themes.join('; ')}.`) : null].filter(Boolean);
  // People Qloo proposed have no interviews in our sources: their own Wikidata description says what they do.
  const d = rec.external?.description;
  const described = !own.length && d ? (es ? (d.es ?? d.en) : (d.en ?? d.es)) : null;
  const offers = own.length ? own.join(' ') : described ? `${described.charAt(0).toUpperCase()}${described.slice(1)}.` : null;
  const latest = rec.appearances[0];
  const months = latest ? (now - Date.parse(latest.published)) / (30.44 * 24 * 3600 * 1000) : null;
  const timely = latest
    ? months !== null && months > 12
      ? es
        ? `Su entrevista más reciente que encontramos es de ${monthYear(latest.published, lang)}.`
        : `The most recent interview we found is from ${monthYear(latest.published, lang)}.`
      : es
        ? `Última entrevista: ${latest.showName}, ${monthYear(latest.published, lang)}.`
        : `Latest interview: ${latest.showName}, ${monthYear(latest.published, lang)}.`
    : rec.source === 'qloo-external' && rec.external?.status === 'documented'
      ? proposedByQloo(rec, lang)
      : null;
  return { key: rec.key, name: rec.name, qloo, offers, kind, timely };
}

/** For the list without Qloo: what happens to this person once Qloo is on (comparison row). */
export function withQlooFate(row: { status: 'kept' | 'entered' | 'left'; affinity: number | null } | undefined, lang: Lang): string | null {
  if (!row) return null;
  const es = lang === 'es';
  const a = row.affinity === null ? null : pct(row.affinity);
  if (row.status === 'kept')
    return a === null ? (es ? 'Se queda también con Qloo.' : 'Stays with Qloo too.') : es ? `Se queda también con Qloo: afinidad con tu público ${a}/100.` : `Stays with Qloo too: audience affinity ${a}/100.`;
  if (row.status !== 'left') return null;
  return a === null
    ? es
      ? 'Sale con Qloo: Qloo no tiene dato de afinidad de este público con esta persona, y entran otros hacia los que sí se inclina.'
      : 'Out with Qloo: Qloo has no affinity value for this audience and this person, and people it does lean toward come in.'
    : es
      ? `Sale con Qloo: buena evidencia, pero este público se inclina poco por esta persona (afinidad ${a}/100).`
      : `Out with Qloo: good evidence, but this audience leans little toward this person (affinity ${a}/100).`;
}

/**
 * No Qloo affinity: says why (not found in Qloo, or found but not scored for this audience), in three
 * wordings that rotate with the card's rank so a list of evidence-only picks does not repeat itself.
 */
function noAffinity(rec: Recommendation, lang: Lang): string {
  const v = Math.max(0, (rec.rank ?? 1) - 1) % 3;
  const es = lang === 'es';
  // Why there is no value: scored nowhere, not in Qloo, or a same-name record we could not confirm.
  if (rec.qlooEntityId)
    return es
      ? ['Qloo conoce a esta persona, pero no le dio puntaje con este público.', 'Está en Qloo, sin puntaje de afinidad para esta audiencia.', 'Qloo no le dio puntaje para este público: entra por la evidencia.'][v]
      : ['Qloo knows this person but gave no score for this audience.', 'In Qloo, with no affinity score for this audience.', 'Qloo did not score this person for this audience: the evidence picks them.'][v];
  if (rec.identity?.reason === 'not_found')
    return es
      ? ['No está en el catálogo de Qloo: entra por la evidencia de sus entrevistas.', 'Fuera del catálogo de Qloo; entra por sus entrevistas verificadas.', 'Sin registro en Qloo: lo respaldan sus entrevistas, no el gusto del público.'][v]
      : ['Not in Qloo’s catalog: picked on interview evidence.', 'Outside Qloo’s catalog; in on verified interviews.', 'No Qloo record: backed by interviews, not by audience taste.'][v];
  if (rec.identity?.status === 'pending')
    return es
      ? ['Qloo tiene a alguien con este nombre, pero no pudimos confirmar que sea la misma persona: no usamos ese dato.', 'Hay un registro con este nombre en Qloo sin contexto que lo confirme; por las dudas, no se usa su afinidad.', 'Qloo no permitió confirmar su identidad (posible homónimo): entra solo por la evidencia.'][v]
      : ['Qloo has someone with this name, but we could not confirm it is the same person: that value is not used.', 'A same-name record in Qloo with nothing to confirm it; to be safe, its affinity is not used.', 'Qloo did not let us confirm the identity (possible namesake): in on evidence alone.'][v];
  return es ? 'Sin dato de Qloo para esta persona: entra por la evidencia.' : 'No Qloo value for this person: in on evidence.';
}

/** For people Qloo proposed: three wordings that rotate with the card's rank, so consecutive cards differ. */
function proposedByQloo(rec: Recommendation, lang: Lang): string {
  const where = rec.external?.wikipedia ? (lang === 'es' ? 'Wikidata y Wikipedia' : 'Wikidata and Wikipedia') : 'Wikidata';
  const v = Math.max(0, (rec.rank ?? 1) - 1) % 3;
  return lang === 'es'
    ? [
        `Lo propuso Qloo; no tiene entrevistas en nuestras fuentes y su identidad está verificada en ${where}.`,
        `Sugerido por Qloo. Sin entrevistas en nuestras fuentes: lo identificamos en ${where}.`,
        `Llegó por Qloo y lo verificamos en ${where}; todavía no tiene entrevistas en nuestras fuentes.`,
      ][v]
    : [
        `Proposed by Qloo; no interviews in our sources, identity verified in ${where}.`,
        `Suggested by Qloo. No interviews in our sources: identified in ${where}.`,
        `Came from Qloo and was verified in ${where}; no interviews in our sources yet.`,
      ][v];
}

/** What the agent did, in four to six plain steps with this run's numbers. */
export function agentSteps(result: Pick<RecommendResult, 'historyEpisodeCount' | 'pastGuestCount' | 'signalStrategy' | 'signalDiagnostics' | 'funnel' | 'discarded' | 'audienceDemographics' | 'qlooMode'>, showName: string, lang: Lang): string[] {
  const es = lang === 'es';
  const g = result.signalDiagnostics.guests;
  const f = result.funnel;
  const tags = result.signalDiagnostics.tags.map((t) => t.accepted).filter((t): t is string => Boolean(t)).slice(0, 3);
  const steps: string[] = [
    es
      ? `Leí ${result.historyEpisodeCount} episodios de ${showName} y encontré ${result.pastGuestCount} invitados anteriores, que no vuelvo a proponer.`
      : `I read ${result.historyEpisodeCount} episodes of ${showName} and found ${result.pastGuestCount} past guests, whom I never propose again.`,
  ];
  if (result.qlooMode === 'LIVE') {
    const signal =
      result.signalStrategy === 'guests'
        ? es ? `Busqué a los invitados anteriores en Qloo: conoce a ${g.confirmed} de ${g.searched}. Con ellos le pregunté a Qloo cómo es tu público.` : `I looked up the past guests in Qloo: it knows ${g.confirmed} of ${g.searched}. With them I asked Qloo what your audience is like.`
        : result.signalStrategy === 'podcast' || result.signalStrategy === 'podcast+tags'
          ? es ? `Encontré ${showName} en Qloo y le pregunté cómo es su público${tags.length ? `, sumando los temas del programa (${list(tags, lang)})` : ''}.` : `I found ${showName} in Qloo and asked what its audience is like${tags.length ? `, adding the show's topics (${list(tags, lang)})` : ''}.`
          : result.signalStrategy === 'tags'
            ? es ? `Qloo casi no conoce este programa: usé solo sus temas (${list(tags, lang)}).` : `Qloo barely knows this show: I used only its topics (${list(tags, lang)}).`
            : es ? 'Qloo no tenía datos de este programa; seguí solo con la evidencia pública.' : 'Qloo had no data on this show; I went on with public evidence only.';
    steps.push(signal);
    if (result.audienceDemographics) steps.push(es ? 'Qloo me devolvió el perfil del público: edad, género y otros gustos.' : 'Qloo returned the audience profile: age, gender and other tastes.');
    if (f.proposed > 0)
      steps.push(
        es
          ? `Qloo me propuso ${f.proposed} personas nuevas; ${f.identityVerified} pasaron la verificación de identidad y ${f.ranked} quedaron como candidatas.`
          : `Qloo proposed ${f.proposed} new people; ${f.identityVerified} passed the identity check and ${f.ranked} became candidates.`,
      );
    steps.push(
      es
        ? 'Ordené a los candidatos verificados por el gusto de tu público según Qloo, con entrevistas reales, en el idioma del programa y sin repetir invitados.'
        : "I ranked the verified candidates by your audience's taste according to Qloo, with real interviews, in the show's language and with no repeat guests.",
    );
  } else steps.push(es ? 'Ordené a los candidatos por la evidencia pública: temas, entrevistas recientes y trayectoria.' : 'I ranked the candidates on public evidence: topics, recent interviews and track record.');
  if (result.discarded.length) steps.push(es ? `Descarté a ${result.discarded.length} por no pasar algún control; el detalle está más abajo.` : `I set aside ${result.discarded.length} who failed a check; the detail is further down.`);
  return steps;
}
