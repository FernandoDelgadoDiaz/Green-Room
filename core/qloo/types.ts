// Qloo integration contract. Everything the agent needs from Qloo goes through QlooAdapter, so the
// MOCK and LIVE implementations are interchangeable and every value carries its mode.
//
// Endpoint shapes follow docs.qloo.com (consulted 2026-10-22):
//   GET /search?query=&types=urn:entity:person&take=     -> { success, duration, results: Entity[] }   (OpenAPI spec)
//   GET /v2/insights?filter.type=…&signal.interests.entities=…&filter.exclude.entities=…&take=
//       -> results.entities[] with affinity under query.affinity (Insights guide; NOT yet validated live)
//   Candidate scoring uses filter.results.entities (Entity Type Parameter Guide, consulted 2026-10-23;
//   same parameter as the official @qloo/qloo-harness 0.1.26 rank workflow).
// The parser in client.ts is tolerant on purpose until the shapes are confirmed against the real API.

export type QlooMode = 'LIVE' | 'MOCK' | 'OFF';

export type InsightsEntityType =
  | 'urn:entity:artist'
  | 'urn:entity:book'
  | 'urn:entity:brand'
  | 'urn:entity:destination'
  | 'urn:entity:movie'
  | 'urn:entity:person'
  | 'urn:entity:place'
  | 'urn:entity:podcast'
  | 'urn:entity:tv_show'
  | 'urn:entity:video_game';

export interface QlooEntity {
  entityId: string;
  name: string;
  type?: string;
  /** 0–1 percentile, when Qloo returns it. */
  popularity?: number;
  /** Affinity to the request's signals, when Qloo returns it. */
  affinity?: number;
  tags?: string[];
  /** Short description, when Qloo returns one (used only for the identity check). */
  description?: string;
}

export interface QlooCall {
  endpoint: string;
  params: Record<string, string>;
  status: number | 'mock' | 'error';
  ms: number;
  resultCount: number;
  note?: string;
}

export interface QlooAdapter {
  readonly mode: QlooMode;
  /** Log of every call made, shown in the agent trace. */
  readonly calls: QlooCall[];
  searchPerson(name: string): Promise<QlooEntity[]>;
  /** People with affinity to the signal entities, excluding the given ids. */
  personInsights(args: { signalIds: string[]; excludeIds: string[]; take: number; popularityMax?: number }): Promise<QlooEntity[]>;
  /** Affinity of specific candidate entities to the signal entities (filter.results.entities). */
  affinityFor(args: { signalIds: string[]; candidateIds: string[] }): Promise<Map<string, number>>;
  /** Cross-domain taste of the audience implied by the signals (artists, films, books…). */
  categoryInsights(args: { signalIds: string[]; type: InsightsEntityType; take: number }): Promise<QlooEntity[]>;
}

export type QlooErrorKind = 'http' | 'network' | 'timeout' | 'budget' | 'deadline' | 'config';

export class QlooError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly kind: QlooErrorKind = status ? 'http' : 'network',
  ) {
    super(message);
    this.name = 'QlooError';
  }
}
