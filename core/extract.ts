// Deterministic guest extraction from public RSS titles/descriptions.
// We never guess: when no rule matches, the episode keeps an empty guest list.

import type { GuestMention } from './types';
import { looksLikePersonName, titleCaseIfShouting } from './names';

/** Words that make a capitalized phrase a role/description rather than a person's name. */
const ROLE_WORDS = new Set(
  [
    'founder', 'cofounder', 'co-founder', 'ceo', 'cmo', 'cto', 'expert', 'doctor', 'scientist', 'leader',
    'commander', 'president', 'professor', 'psychologist', 'coach', 'author', 'investor', 'billionaire',
    'champion', 'the', 'of', 'and', 'your', 'how', 'why', 'what', 'this', 'that', 'most', 'moment', 'world',
    'ai', 'war', 'guide', 'secrets', 'secret', 'truth', 'story', 'real', 'special', 'forces', 'neuroscientist',
    'surgeon', 'psychiatrist', 'nutritionist', 'economist', 'historian', 'monk', 'agent', 'detective',
    'whistleblower', 'olympian', 'navy', 'seal', 'marketing', 'money', 'brain', 'sleep', 'hormone', 'dating',
    'relationship', 'body', 'language', 'mindset', 'happiness', 'productivity', 'longevity', 'finance', 'no',
    'new', 'live', 'episode', 'part', 'bonus', 'trailer', 'qa', 'q&a', 'lie', 'detector', 'leading', 'researcher',
    'warning', 'apologist', 'emergency', 'debate', 'physicist', 'proves', 'aliens', 'exist', 'top', 'cia', 'fbi',
    'security', 'advisor', 'legend', 'ufc', 'nfl', 'nba', 'great', 'interview', 'christian', 'atheist', 'former',
    'ex', 'best', 'biggest', 'only', 'man', 'woman', 'girl', 'boy', 'guy', 'king', 'queen', 'mom', 'dad',
  ].map((w) => w.toLowerCase()),
);

function hasRoleWord(s: string): boolean {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\s&'-]/gu, ' ')
    .split(/\s+/)
    .some((t) => ROLE_WORDS.has(t));
}

function cleanNameCandidate(s: string): string {
  return s
    .replace(/\(.*?\)/g, ' ')
    .replace(/["“”!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const HONORIFIC_PREFIX = /^(?:dr\.?|prof\.?|professor|secretary|vice president|president|prime minister|senator|sir|dame|general)\s+/i;

function asPerson(raw: string, confidence: GuestMention['confidence'], method: GuestMention['method'] = 'title-pattern', minTokens = 2): GuestMention | null {
  const c = cleanNameCandidate(raw).replace(HONORIFIC_PREFIX, '');
  if (/['’]s\b/.test(c)) return null;
  if (!looksLikePersonName(c, { minTokens }) || hasRoleWord(c)) return null;
  return { name: titleCaseIfShouting(c), method, confidence };
}

/** Splits "A and B" / "A & B" into separate people when both halves look like names. */
function splitCoGuests(m: GuestMention): GuestMention[] {
  const parts = m.name.split(/\s+(?:and|&|y|Y)\s+/);
  if (parts.length === 2 && parts.every((p) => looksLikePersonName(p))) {
    return parts.map((p) => ({ ...m, name: p.trim() }));
  }
  return [m];
}

// ---------------------------------------------------------------- Lex Fridman Podcast
// Formats observed in the feed:
//   "#383 – Mark Zuckerberg: Future of AI at Meta…"
//   "#488 – Infinity, Paradoxes … – Joel David Hamkins"
//   "#502 – Psychiatry, Insane Asylums…"  (name only in description: "Andrew Scull is a historian…")
//   "Max Tegmark: Life 3.0"               (early episodes, no number)
export function extractLexGuests(title: string, description: string): GuestMention[] {
  const body = title.replace(/^#\d+\s*[–-]\s*/, '').trim();
  const dashParts = body.split(/\s+–\s+/);
  if (dashParts.length > 1) {
    const tail = asPerson(dashParts[dashParts.length - 1], 'high');
    if (tail) return splitCoGuests(tail);
  }
  const colon = body.indexOf(':');
  if (colon > 0) {
    const lead = asPerson(body.slice(0, colon), 'high');
    if (lead) return splitCoGuests(lead);
  }
  const text = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const m = text.match(/^(.{3,80}?)\s+(?:is|are|was)\s+(?:a|an|the|one|co-|former|professor|author|founder|director|host|historian|chief)/i);
  if (m) {
    const parts = m[1].split(/\s*,\s*|\s+and\s+/).filter(Boolean);
    const people = parts
      .map((p) => asPerson(p, 'medium', 'description-first-sentence'))
      .filter((p): p is GuestMention => p !== null);
    if (people.length === parts.length && people.length > 0) return people;
  }
  return [];
}

// ---------------------------------------------------------------- The Diary Of A CEO
const DOAC_EXCLUDE: Array<[RegExp, string]> = [
  [/^most replayed moment/i, 'clip compilation (re-run of an earlier episode)'],
  [/^moment\s*\d+/i, 'short clip episode'],
  [/^e\d+\s*:/i, 'host solo episode'],
  [/\btrailer\b/i, 'trailer'],
];

export function doacExclusion(title: string): string | null {
  for (const [re, reason] of DOAC_EXCLUDE) if (re.test(title.trim())) return reason;
  return null;
}

// Formats: "Rainn Wilson: …", "… | Dr Sahar Yousef", "… - Tim Spector", "…: Rory Sutherland".
// Trailing slots are checked first because leading slots are often roles ("Klarna Founder: …").
export function extractDoacGuests(title: string): GuestMention[] {
  const t = title.trim();
  const pipe = t.split(/\s+\|\s+/);
  if (pipe.length > 1) {
    const p = asPerson(pipe[pipe.length - 1].replace(/^dr\.?\s+/i, ''), 'high');
    if (p) return splitCoGuests(p);
  }
  const hyphen = t.split(/\s+[-–]\s+/);
  if (hyphen.length > 1) {
    const p = asPerson(hyphen[hyphen.length - 1], 'high');
    if (p) return splitCoGuests(p);
  }
  const colonParts = t.split(/:\s+/);
  if (colonParts.length > 1) {
    const tail = asPerson(colonParts[colonParts.length - 1], 'medium');
    if (tail) return splitCoGuests(tail);
    const lead = asPerson(colonParts[0], 'high');
    if (lead) return splitCoGuests(lead);
  }
  return [];
}

// ---------------------------------------------------------------- CREATIVO (Roberto Mtz)
// Formats: "683. JAVIER PANIAGUA | El Músico Es Víctima…", "GERA MX | …", "04. Charlie Rodd",
//          "679. ¿Regresas el Carrito del Súper? | Andreas Östberg".
const CREATIVO_NOT_GUESTS = new Set(['creativo', 'recreativo', 'no hay invitado', 'bizarro', 'roberto responde', 'preguntas incómodas', 'preguntas incomodas']);

function isMostlyUppercase(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  return upper / letters.length >= 0.8;
}

/** Re-uploads carry the original year in the name slot: "EL TREN (2023) | …". */
export function isCreativoRerun(title: string): boolean {
  return /^[^|]*\((?:19|20)\d{2}\)/.test(title.replace(/^\d+\.\s*/, ''));
}

export function creativoExclusion(title: string): string | null {
  if (/no hay invitado/i.test(title)) return 'host-only episode ("no hay invitado")';
  if (/^\d+\.\s*recreativo\b/i.test(title) || /^recreativo\b/i.test(title)) return 'host panel segment (RECREATIVO)';
  return null;
}

export function extractCreativoGuests(title: string): GuestMention[] {
  const body = title.replace(/^\d+\.\s*/, '').trim();
  const withPattern = body.match(/\bc\/\s*([^|]+)$/);
  if (withPattern) {
    const p = asPerson(withPattern[1], 'high');
    if (p) return splitCoGuests(p);
  }
  const segments = body.split(/\s+\|\s+/).map((s) => s.trim());
  const first = cleanNameCandidate(segments[0]);
  if (isMostlyUppercase(first) && !/[¿?&#:]/.test(segments[0]) && !CREATIVO_NOT_GUESTS.has(first.toLowerCase())) {
    // The uppercase slot is the explicit guest slot in this feed; stage names can be one token ("NSQK").
    const halves = first.split(/\s+Y\s+/).map((p) => p.trim());
    // "MAU Y RICKY" is a duo's name; only split when both halves are full names.
    const people = halves.length === 2 && halves.every((h) => h.split(/\s+/).length >= 2) ? halves : [first];
    if (people.every((p) => p.split(/\s+/).length <= 4)) {
      return people.map((p) => ({
        name: titleCaseIfShouting(p),
        method: 'title-pattern' as const,
        confidence: p.split(/\s+/).length >= 2 ? ('high' as const) : ('medium' as const),
      }));
    }
  }
  if (segments.length === 1) {
    // Mixed-case titles without a pipe are names only in the early episodes ("04. Charlie Rodd").
    const p = first.split(/\s+/).length <= 3 && !/\b(?:la|el|me|mi|de|y)\b/.test(first) ? asPerson(first, 'medium') : null;
    return p ? [p] : [];
  }
  for (const seg of segments.slice(1)) {
    const p = asPerson(titleCaseIfShouting(seg), 'medium');
    if (p) return splitCoGuests(p);
  }
  return [];
}
