// Interview proposal drafted only from evidence already attached to the recommendation.
// No language model: every sentence is traceable to a field of the recommendation. Episode titles
// are quoted in their original language; only our own wording changes with `lang`.

import type { Recommendation } from './agent/agent';

export type Lang = 'en' | 'es';

export interface Proposal {
  subject: string;
  body: string;
  talkingPoints: string[];
  basedOn: string[];
}

export function draftProposal(
  rec: Recommendation,
  show: { name: string; host: string },
  themes: Array<{ label: string; labelEs?: string }>,
  lang: Lang = 'en',
): Proposal {
  const es = lang === 'es';
  const latest = rec.appearances[0];
  const shared = rec.sharedThemes.map((s) => (es ? s.labelEs : s.label));
  const themeLabels = themes.slice(0, 2).map((t) => (es ? (t.labelEs ?? t.label) : t.label));
  const joinAnd = (xs: string[]) => new Intl.ListFormat(lang, { type: 'conjunction' }).format(xs);
  const themeLine = shared.length ? joinAnd(shared) : joinAnd(themeLabels);
  const talkingPoints = [
    ...rec.conversationTopics.slice(0, 3).map((t) => (es ? `Profundizar más que la última vez en: ${t}` : `Go deeper than before on: ${t}`)),
    ...(shared.length
      ? [es ? `Conectar tu trabajo con lo que ${show.name} retoma una y otra vez: ${shared.join(', ')}` : `Connect your work to what ${show.name} keeps coming back to: ${shared.join(', ')}`]
      : []),
  ];
  const date = latest?.published.slice(0, 10);
  const lines = es
    ? [
        `Hola ${rec.name.split(' ')[0]}:`,
        '',
        `Conduzco ${show.name}. Nuestras conversaciones vuelven una y otra vez a ${themeLine || 'temas que le importan a nuestra audiencia'}, y tu mirada encaja con ese hilo.`,
        latest ? `Escuché tu conversación en ${latest.showName} (“${latest.title}”, ${date}) y me encantaría retomarla desde donde quedó.` : '',
        '',
        'Algunas direcciones posibles:',
        ...talkingPoints.map((t) => `• ${t}`),
        '',
        '¿Te interesaría una conversación de formato largo en los próximos meses?',
        '',
        `— ${show.host}`,
      ]
    : [
        `Hi ${rec.name.split(' ')[0]},`,
        '',
        `I host ${show.name}. Our conversations keep returning to ${themeLine || 'ideas our listeners care about'}, and your perspective fits that thread.`,
        latest ? `I came across your conversation on ${latest.showName} (“${latest.title}”, ${date}) and would love to pick up where it left off.` : '',
        '',
        'A few directions we could take:',
        ...talkingPoints.map((t) => `• ${t}`),
        '',
        'Would you be open to a long-form conversation in the coming months?',
        '',
        `— ${show.host}`,
      ];
  return {
    subject: es ? `Invitación a ${show.name}` : `Invitation to ${show.name}`,
    body: lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n'),
    talkingPoints,
    basedOn: [
      ...(latest ? [es ? `Aparición: ${latest.showName}, ${date} (VERIFIED)` : `Appearance: ${latest.showName}, ${date} (VERIFIED)`] : []),
      ...(shared.length ? [es ? `Temas compartidos: ${shared.join(', ')} (INFERRED)` : `Shared themes: ${shared.join(', ')} (INFERRED)`] : []),
      es ? 'Texto borrador: revisalo y personalizalo antes de enviarlo.' : 'Draft text — review and personalize before sending.',
    ],
  };
}
