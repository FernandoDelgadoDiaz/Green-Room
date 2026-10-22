// Interview proposal drafted only from evidence already attached to the recommendation.
// No language model: every sentence is traceable to a field of the recommendation.

import type { Recommendation } from './agent/agent';

export interface Proposal {
  subject: string;
  body: string;
  talkingPoints: string[];
  basedOn: string[];
}

export function draftProposal(rec: Recommendation, show: { name: string; host: string }, themes: Array<{ label: string }>): Proposal {
  const latest = rec.appearances[0];
  const shared = rec.sharedThemes.map((s) => s.label);
  const themeLine = shared.length ? shared.join(' and ') : themes.slice(0, 2).map((t) => t.label).join(' and ');
  const talkingPoints = [
    ...rec.conversationTopics.slice(0, 3).map((t) => `Go deeper than before on: ${t}`),
    ...(shared.length ? [`Connect your work to what ${show.name} keeps coming back to: ${shared.join(', ')}`] : []),
  ];
  const lines = [
    `Hi ${rec.name.split(' ')[0]},`,
    '',
    `I host ${show.name}. Our conversations keep returning to ${themeLine || 'ideas our listeners care about'}, and your perspective fits that thread.`,
    latest ? `I came across your conversation on ${latest.showName} (“${latest.title}”, ${latest.published.slice(0, 10)}) and would love to pick up where it left off.` : '',
    '',
    'A few directions we could take:',
    ...talkingPoints.map((t) => `• ${t}`),
    '',
    'Would you be open to a long-form conversation in the coming months?',
    '',
    `— ${show.host}`,
  ].filter((l, i, arr) => !(l === '' && arr[i - 1] === ''));
  return {
    subject: `Invitation to ${show.name}`,
    body: lines.join('\n'),
    talkingPoints,
    basedOn: [
      ...(latest ? [`Appearance: ${latest.showName}, ${latest.published.slice(0, 10)} (VERIFIED)`] : []),
      ...(shared.length ? [`Shared themes: ${shared.join(', ')} (INFERRED)`] : []),
      'Draft text — review and personalize before sending.',
    ],
  };
}
