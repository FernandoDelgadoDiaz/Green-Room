// Catalog views. A show is listed under a country only for its VERIFIED origin; chart positions
// are popularity information and never decide the country (data/catalog/sources.json, originRule).

export interface WithOrigin {
  origin: { country: string | null; status: string };
}

export const hasVerifiedOrigin = (s: WithOrigin, country?: string) => s.origin.status === 'verified' && Boolean(s.origin.country) && (!country || s.origin.country === country);

/** Shows made in `country`, by verified origin. */
export function showsFromCountry<T extends WithOrigin>(shows: T[], country: string): T[] {
  return shows.filter((s) => hasVerifiedOrigin(s, country));
}

/** Shows whose origin could not be verified: kept visible, never classified as national. */
export function unclassifiedShows<T extends WithOrigin>(shows: T[]): T[] {
  return shows.filter((s) => !hasVerifiedOrigin(s));
}
