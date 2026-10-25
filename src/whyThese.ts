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

export function guestWhy(rec: Recommendation, lang: Lang, now = Date.now(), showName = ''): GuestWhy {
  const es = lang === 'es';
  const q = rec.qlooAudience;
  // The show itself as the only reason says nothing new (shows matched by their own Qloo entity).
  const by = (q?.explainedBy ?? []).filter((n) => n !== showName);
  const qloo =
    q?.affinity === null || q?.affinity === undefined
      ? es
        ? 'Qloo no tiene dato de afinidad para esta persona.'
        : 'Qloo has no affinity value for this person.'
      : (es ? `Afinidad con tu público: ${pct(q.affinity)} de 100, comparada con los demás candidatos.` : `Affinity with your audience: ${pct(q.affinity)} out of 100, compared with the other candidates.`) +
        (by.length ? (es ? ` Lo que más pesó: ${list(by, lang)}.` : ` What weighed most: ${list(by, lang)}.`) : '');
  const themes = citableThemes(rec).slice(0, 2).map((s) => (es ? s.labelEs : s.label));
  // Only a position that says of what ("CEO of Anthropic"), as in the invitation letters.
  const pos = specificPosition(rec.audience?.positions);
  const position = pos ? positionLabel(pos, lang, rec.audience) : null;
  const offers = [position ? `${position.charAt(0).toUpperCase()}${position.slice(1)}.` : null, themes.length ? (es ? `Habla de temas frecuentes del programa: ${themes.join('; ')}.` : `Talks about frequent topics on the show: ${themes.join('; ')}.`) : null]
    .filter(Boolean)
    .join(' ') || null;
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
    : null;
  return { key: rec.key, name: rec.name, qloo, offers, timely };
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
