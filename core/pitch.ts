// Interview proposal drafted only from evidence already attached to the recommendation.
// No language model: every sentence is traceable to a field of the recommendation. Episode titles
// are quoted in their original language; only our own wording changes with `lang`.
// Each letter is built from what is particular to the guest (what they do now, who of their kind the
// show already had, their latest interview and its topic), and the wording rotates with the card's
// position, so two letters in a row never read alike. Spanish avoids voseo and tuteo verb forms: the
// same letter works for shows in Argentina, Mexico and Spain.

import { clipTopic, topicPhrase } from './topic';
import { CATEGORY_LABELS } from './people';
import type { Recommendation } from './agent/agent';

export type Lang = 'en' | 'es';

export interface Proposal {
  subject: string;
  body: string;
  talkingPoints: string[];
  basedOn: string[];
}

const monthYear = (iso: string, lang: Lang) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
};
const lowerFirst = (s: string) => (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function draftProposal(
  rec: Recommendation,
  show: { name: string; host: string },
  themes: Array<{ label: string; labelEs?: string }>,
  lang: Lang = 'en',
  opts: { kindClaims?: boolean } = {},
): Proposal {
  const es = lang === 'es';
  const v = Math.max(0, (rec.rank ?? 1) - 1) % 3;
  const a = rec.audience;
  // "JD Vance" → "JD Vance", "Yuri" → "Yuri", "Axel Kicillof" → "Axel".
  const token = rec.name.split(' ')[0];
  const first = rec.name.split(' ').length < 2 || /^[A-Z]{1,3}$/.test(token) ? rec.name : token;
  const joinAnd = (xs: string[]) => new Intl.ListFormat(lang, { type: 'conjunction' }).format(xs);
  const citable = rec.sharedThemes.filter((s) => new Set(s.words).size >= 2).map((s) => (es ? s.labelEs : s.label));
  const themeLine = joinAnd(citable.length ? citable : themes.slice(0, 2).map((t) => (es ? (t.labelEs ?? t.label) : t.label)));

  // What they do now, and who of their kind already came on the show.
  const pos = a?.positions?.[0];
  const position = pos ? (es ? lowerFirst(pos.es) : pos.en) : null;
  const award = a?.awards?.[0] ? (es ? a.awards[0].es : a.awards[0].en) : null;
  const cat = opts.kindClaims === false ? null : (a?.sharedCategories.find((c) => (a.similarByCategory?.[c] ?? []).length) ?? null);
  const similar = cat ? a!.similarByCategory![cat]! : [];
  const names = joinAnd(similar);

  // Their latest interview, with what it was about (from that same title).
  const latest = rec.appearances[0];
  const topicOf = (x: (typeof rec.appearances)[number]) => {
    const t = topicPhrase(x.title, rec.name);
    return t ? clipTopic(t, 90) : null;
  };
  const latestTopic = latest ? topicOf(latest) : null;
  const when = latest ? monthYear(latest.published, lang) : null;

  const opening = es
    ? similar.length
      ? [
          `Te escribo desde ${show.name}. Por el programa ya pasaron ${names}, y nos encantaría sumar tu mirada${position ? `, sobre todo desde tu lugar como ${position}` : ''}.`,
          `Conduzco ${show.name}, donde ya conversamos con ${names}. ${position ? `Tu trabajo como ${position} es justo el tipo de experiencia que nuestra audiencia busca.` : 'Tu recorrido es justo el tipo de experiencia que nuestra audiencia busca.'}`,
          `En ${show.name} recibimos a ${CATEGORY_LABELS[cat!].esPlural} como ${names}, y hace tiempo que queremos tenerte en el programa${position ? ` para hablar de tu tarea como ${position}` : ''}.`,
        ][v]
      : position
        ? `Te escribo desde ${show.name}. Nos interesa mucho conversar sobre tu trabajo como ${position}.`
        : `Te escribo desde ${show.name}, un programa que dedica buena parte de sus conversaciones a ${themeLine || 'temas que le importan a nuestra audiencia'}.`
    : similar.length
      ? [
          `I'm writing from ${show.name}. ${names} ${similar.length === 1 ? 'has' : 'have'} been on the show, and we'd love to add your perspective${position ? `, especially as ${position}` : ''}.`,
          `I host ${show.name}, where we've talked with ${names}. ${position ? `Your work as ${position} is exactly the kind of experience our audience comes for.` : 'Your path is exactly the kind of experience our audience comes for.'}`,
          `${show.name} has hosted ${CATEGORY_LABELS[cat!].enPlural} such as ${names}, and we've wanted you on the show for a while${position ? ` to talk about your work as ${position}` : ''}.`,
        ][v]
      : position
        ? `I'm writing from ${show.name}. We'd love to talk about your work as ${position}.`
        : `I'm writing from ${show.name}, a show that spends much of its time on ${themeLine || 'ideas our listeners care about'}.`;

  const hook = latest
    ? es
      ? latestTopic
        ? [
            `Escuchamos tu conversación en ${latest.showName} (${when}) sobre “${latestTopic}” y nos quedamos con ganas de seguir ese hilo.`,
            `Tu charla en ${latest.showName} de ${when}, sobre “${latestTopic}”, fue lo que nos llevó a escribirte.`,
            `Nos quedó resonando lo que contaste en ${latest.showName} en ${when} sobre “${latestTopic}”.`,
          ][v]
        : `Vimos tu paso por ${latest.showName} en ${when} y nos gustaría retomar esa conversación con más tiempo.`
      : latestTopic
        ? [
            `We heard your conversation on ${latest.showName} (${when}) about “${latestTopic}” and want to pick up that thread.`,
            `Your talk on ${latest.showName} in ${when}, about “${latestTopic}”, is what made us write to you.`,
            `What you said on ${latest.showName} in ${when} about “${latestTopic}” stayed with us.`,
          ][v]
        : `We caught your appearance on ${latest.showName} in ${when} and would love to continue that conversation with more time.`
    : '';

  // Talking points: their own topics first, then what they do now, an award, and the show's themes.
  const topics = [...new Set(rec.appearances.slice(0, 4).map(topicOf).filter((t): t is string => Boolean(t)))].slice(0, 2);
  const talkingPoints = [
    ...topics.map((t, i) => (es ? [`Retomar “${t}”, con más tiempo que la última vez`, `Ir más a fondo en “${t}”`][i] : [`Return to “${t}”, with more time than last time`, `Go deeper into “${t}”`][i])),
    ...(position ? [es ? `Lo que implica hoy ser ${position}` : `What being ${position} looks like today`] : []),
    ...(award ? [es ? `El camino hasta ${award}` : `The road to ${award}`] : []),
    ...(citable.length ? [es ? `Cómo se cruza tu trabajo con ${themeLine}, temas frecuentes del programa` : `Where your work meets ${themeLine}, frequent topics on the show`] : []),
  ].slice(0, 4);

  const closing = es
    ? ['¿Te interesaría una conversación de formato largo en los próximos meses? Nos adaptamos a tu agenda.', '¿Te sumarías a una charla larga, sin apuro, en los próximos meses?', 'Si te interesa, armamos la fecha que mejor te quede en los próximos meses.'][v]
    : ['Would you be open to a long-form conversation in the coming months? We will work around your schedule.', 'Would you join us for an unhurried, long-form conversation in the coming months?', 'If this sounds good, we will find a date that suits you in the coming months.'][v];

  const lines = [
    es ? `Hola, ${first}:` : `Hi ${first},`,
    '',
    opening,
    hook,
    '',
    ...(talkingPoints.length ? [es ? 'Algunas ideas para la conversación:' : 'A few ideas for the conversation:', ...talkingPoints.map((t) => `• ${t}`), ''] : []),
    closing,
    '',
    `— ${show.host}`,
  ];
  return {
    subject: es ? `Invitación a ${show.name}${position ? ` · ${position}` : ''}` : `Invitation to ${show.name}${position ? ` · ${position}` : ''}`,
    body: lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n'),
    talkingPoints,
    basedOn: [
      ...(latest ? [es ? `Aparición: ${latest.showName}, ${when} (VERIFIED)` : `Appearance: ${latest.showName}, ${when} (VERIFIED)`] : []),
      ...(pos ? [es ? `Cargo actual: ${position} (Wikidata)` : `Current position: ${position} (Wikidata)`] : []),
      ...(similar.length ? [es ? `Invitados anteriores del mismo perfil: ${names}` : `Past guests of the same kind: ${names}`] : []),
      ...(citable.length ? [es ? `Temas compartidos: ${citable.join(', ')} (INFERRED)` : `Shared themes: ${citable.join(', ')} (INFERRED)`] : []),
      es ? 'Texto borrador: revisalo y personalizalo antes de enviarlo.' : 'Draft text — review and personalize before sending.',
    ],
  };
}

