// Name → Qloo person entity. A name is never enough on its own: the match must be exact and unique
// (namesakes → ambiguous) AND Qloo's own description/tags must share context with the person's
// interview titles (checkIdentity). Anything less is "pending verification", not a match.

import { sameName } from '../names';
import { contextOverlap } from '../profiles';
import type { QlooEntity } from './types';

export type Resolution =
  | { status: 'exact'; entity: QlooEntity; alternatives: number }
  | { status: 'ambiguous'; candidates: QlooEntity[] }
  | { status: 'fuzzy'; candidates: QlooEntity[] }
  | { status: 'none' };

export function resolvePerson(hits: QlooEntity[], name: string): Resolution {
  const exact = hits.filter((h) => sameName(h.name, name));
  // The same entity can come back twice; namesakes have different ids.
  const ids = new Set(exact.map((h) => h.entityId));
  if (ids.size === 1) return { status: 'exact', entity: exact[0], alternatives: hits.length - exact.length };
  if (ids.size > 1) return { status: 'ambiguous', candidates: exact };
  return hits.length ? { status: 'fuzzy', candidates: hits } : { status: 'none' };
}

/**
 * Context evidence that a Qloo entity is the same person as our guest: words shared by Qloo's
 * description/tags and the person's own interview titles (same 6-letter-stem rule as the photo
 * check). An exact, unique name with no shared context is NOT accepted as an identity.
 */
export function identityEvidence(entity: QlooEntity, name: string, interviewTitles: string[]): string[] {
  const text = [entity.description ?? '', ...(entity.tags ?? [])].join(' ');
  return text.trim() ? contextOverlap(name, text, interviewTitles) : [];
}

export type IdentityCheck = { status: 'confirmed'; entity: QlooEntity; evidence: string[] } | { status: 'pending'; reason: 'no_context' | 'ambiguous' | 'fuzzy' } | { status: 'not_found' };

export function checkIdentity(hits: QlooEntity[], name: string, interviewTitles: string[]): IdentityCheck {
  const r = resolvePerson(hits, name);
  if (r.status === 'none') return { status: 'not_found' };
  if (r.status === 'ambiguous') return { status: 'pending', reason: 'ambiguous' };
  if (r.status === 'fuzzy') return { status: 'pending', reason: 'fuzzy' };
  const evidence = identityEvidence(r.entity, name, interviewTitles);
  return evidence.length ? { status: 'confirmed', entity: r.entity, evidence } : { status: 'pending', reason: 'no_context' };
}
