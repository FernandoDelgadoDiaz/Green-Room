// Generic guest extraction for catalog shows without a hand-written rule. Conservative by design:
// a title segment counts as a guest only if the WHOLE segment looks like a person's name (2–4
// capitalized tokens, no role/topic words, not the host). Everything found here has confidence
// 'low' and method 'title-pattern'; the agent reports coverage and never treats a miss as proof.

import type { GuestMention } from './types';
import { cleanNameCandidate, hasRoleWord } from './extract';
import { looksLikePersonName, nameKey } from './names';

// Episode markers and show branding stripped before splitting.
const NOISE = [
  /\bS\d+\s*EP?\s*\d+\b/gi, // S8 EP9
  /#\s*\d+/g, // #2568
  /\b(?:ep(?:isodio|isode)?|e)\.?\s*\d+\b/gi, // Ep. 451, Episodio 12, E444
  /\b(?:especial|special)\s+\d+\b/gi,
  /#[A-Za-z]+\b/g, // #LFDE
  /\bTOP RATED\b/gi,
  /\bRecomendado\b:?/gi,
  /\((?:EN VIVO|LIVE|Tasting Menu|Part \d+|Parte \d+|Rebroadcast)\)/gi,
];

// Words that make a capitalized segment a topic rather than a name, in Spanish and English.
const TOPIC_WORDS = new Set(
  'el la los las un una de del en y o que por para con sin sobre como cómo qué por qué mi tu su lo es son no sí más menos todo nada vida muerte dinero amor éxito ia historia secreto verdad podcast show project episodio entrevista conversación tertulia mesa debate especial expediente españa vacía the a an in on of for with and or is are my your our why how what when who this that life money love'
    .split(' '),
);

function isNameSegment(seg: string, hostKeys: Set<string>): string | null {
  const s = cleanNameCandidate(seg)
    .replace(/^[\s.,;:#–—-]+/, '')
    .replace(/^(?:Dra?\.|Dr|Prof\.?|Sir|Dame)\s+/i, '')
    .replace(/[\s.,;:–—-]+$/g, '')
    .replace(/\s+(?:y|and|&|e)$/i, '')
    .trim();
  // All-caps segments are almost always topics in these feeds ("ARRUINADORES DE CANCIONES"): skip.
  const longToks = s.split(/\s+/).filter((w) => w.replace(/[^\p{L}]/gu, '').length >= 3);
  if (longToks.length && longToks.filter((w) => w === w.toUpperCase()).length * 2 >= longToks.length && !/^[A-Z]{2}\b/.test(s)) return null;
  if (!looksLikePersonName(s) || s.split(/\s+/).length > 4) return null;
  if (hasRoleWord(s)) return null;
  const toks = s.toLowerCase().split(/\s+/);
  if (toks.some((t) => TOPIC_WORDS.has(t) && !['de', 'del', 'la', 'van', 'y'].includes(t))) return null;
  if (hostKeys.has(nameKey(s))) return null;
  return s;
}

/** A slot is accepted only if it is one name, or several names joined by "and"/"y"/"&". */
function namesInSlot(slot: string, hostKeys: Set<string>): string[] {
  const parts = slot.split(/\s+(?:and|y|&)\s+/i);
  const names = parts.map((p) => isNameSegment(p, hostKeys));
  return names.every((n): n is string => Boolean(n)) ? (names as string[]) : [];
}

/**
 * Looks only at the slots where podcasts put the guest's name: the whole title, the first or last
 * segment between separators, a parenthesized name, "Name on/discusses …" at the start, and
 * "with/con Name" at the very end. Mid-title mentions are ignored (they are usually topics).
 */
export function extractGenericGuests(title: string, hostAliases: string[], showName: string): GuestMention[] {
  const hostKeys = new Set(hostAliases.map(nameKey));
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let t = title;
  for (const re of NOISE) t = t.replace(re, ' ');
  t = t.replace(new RegExp(`\\b(?:en|on|at|in)\\s+${esc(showName)}\\b`, 'gi'), ' ').replace(new RegExp(esc(showName), 'gi'), ' ');
  t = t.replace(/^[\s.,;:#|–—-]+/, '').replace(/[\s.,;:#|–—-]+$/, '').replace(/\s+/g, ' ');
  const found = new Map<string, string>();
  const take = (names: string[]) => names.forEach((n) => found.has(nameKey(n)) || found.set(nameKey(n), n));

  // "Name sobre …" puts the guest first and the topic after: names in the topic are not guests
  // ("Horacio Tarcus sobre sus charlas con Ricardo Piglia" → Tarcus only).
  const lead = /^(?:(?:con|with)\s+)?([^:|–—()"“]{3,60}?)\s+(?:on|discusses|talks|reveals|explains|returns|habla|cuenta|revela|explica|sobre)\b/i.exec(t);
  const leadNames = lead ? namesInSlot(lead[1], hostKeys) : [];
  take(leadNames);
  const topicFollows = leadNames.length > 0 && /\bsobre\b/i.test(t.slice(lead!.index + lead![0].length - 6));
  const tailWith = /\b(?:with|con|feat\.?|ft\.?|w\/)\s+([^|:()–—]{3,80})$/i.exec(t);
  if (tailWith && !topicFollows) take(namesInSlot(tailWith[1], hostKeys));
  for (const m of t.matchAll(/\(([^)]{3,60})\)/g)) take(namesInSlot(m[1], hostKeys));
  const segs = t
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s*(?:\||:|–|—|\s-\s|«|»|"|“|”)\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (segs.length) {
    const firstNames = namesInSlot(segs[0], hostKeys);
    take(firstNames);
    // Shows put the name either first or last; a name-like last segment after a lead name is a topic.
    // A quoted last segment after "X sobre …" is a work's title (a book, a film), not a guest.
    const last = segs[segs.length - 1];
    const quotedTopic = Boolean(lead) && new RegExp(`["“«]\\s*${esc(last)}`).test(t);
    if (segs.length > 1 && !firstNames.length && !found.size && !quotedTopic) take(namesInSlot(last, hostKeys));
  }
  return [...found.values()].map((name) => ({ name, method: 'title-pattern' as const, confidence: 'low' as const }));
}
