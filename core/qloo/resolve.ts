// Name → Qloo person entity. Exact canonical-name match only, and only when it is unique:
// two Qloo people with the same name are treated as ambiguous and left unresolved instead of
// picking one (same policy as the photo/bio identity check in core/profiles.ts).

import { sameName } from '../names';
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
