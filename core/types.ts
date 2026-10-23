// Shared domain types. Every value shown to a user carries a provenance label.

/** VERIFIED: read directly from a public source (RSS feed).
 *  INFERRED: derived by our own deterministic heuristics from verified data.
 *  MOCK: simulated stand-in for a Qloo response (no API key yet).
 *  LIVE: returned by the real Qloo hackathon API. */
export type Provenance = 'VERIFIED' | 'INFERRED' | 'MOCK' | 'LIVE';

export type ExtractionMethod =
  | 'title-pattern'
  | 'description-first-sentence'
  | 'manual-override'
  | 'none';

export interface GuestMention {
  name: string;
  method: ExtractionMethod;
  /** 'high' = explicit name slot in the title; 'medium' = heuristic; 'low' = ambiguous. */
  confidence: 'high' | 'medium' | 'low';
}

export interface Episode {
  id: string;
  title: string;
  /** ISO-8601 date of publication from the feed's pubDate. */
  published: string;
  url: string | null;
  guests: GuestMention[];
  /** True for clips, trailers, solo/host episodes we exclude from guest history. */
  excluded: boolean;
  excludedReason?: string;
  /** Re-upload of an older interview: counts as a past appearance, never as a new booking. */
  rerun?: boolean;
}

export interface PodcastSource {
  feedUrl: string;
  website: string;
  retrievedAt: string;
  retrievedVia: string;
  note: string;
}

export interface PodcastDataset {
  id: string;
  name: string;
  host: string;
  hostAliases: string[];
  language: string;
  description: string;
  source: PodcastSource;
  episodes: Episode[];
}

export interface Appearance {
  showId: string;
  showName: string;
  episodeId: string;
  title: string;
  published: string;
  url: string | null;
  /** Extraction confidence of the guest name in this appearance's title. */
  confidence?: GuestMention['confidence'];
  /** Language of this interview: its title when clear-cut, else the show's declared language. */
  language?: string;
}
