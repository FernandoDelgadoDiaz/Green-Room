// What a guest does now (Wikidata P39), as a phrase a card or a letter can use.

type Position = { en: string; es: string; since: string | null };

/** Only positions that name where they are held ("Governor of Buenos Aires Province"), not a bare "Chief executive officer". */
export const specificPosition = (ps: Position[] | undefined) => ps?.find((p) => /\s(of|for)\s/i.test(` ${p.en} `) || /\s(de|del)\s/i.test(` ${p.es} `));

/**
 * Wikidata stores Spanish position labels in the masculine ("senador de Argentina"). When the person's
 * own Spanish Wikipedia opening says "es una …" (or their description ends in a feminine nationality),
 * the leading title is put in the feminine: senadora, gobernadora, ministra, presidenta, jefa…
 */
export function isWoman(p: { bio?: { es: string | null } | null; description?: { es: string | null } | null } | null | undefined): boolean {
  const bio = p?.bio?.es ?? '';
  if (/\bes una\b/.test(bio)) return true;
  if (/\bes un\b/.test(bio)) return false;
  return /\b\w+(ina|ana|ola|esa|ensa|iana|ona)\s*$/.test((p?.description?.es ?? '').replace(/\s*\([^)]*\)/g, '').trim());
}

const SPECIAL: Record<string, string> = { presidente: 'presidenta', vicepresidente: 'vicepresidenta', jefe: 'jefa', alcalde: 'alcaldesa', intendente: 'intendenta', miembro: 'miembro', titular: 'titular', concejal: 'concejala', juez: 'jueza' };

export function feminineTitle(label: string): string {
  return label.replace(/^(\p{L}+)/u, (w) => {
    const lower = w.toLowerCase();
    const f = SPECIAL[lower] ?? (/(or)$/.test(lower) ? `${lower}a` : /o$/.test(lower) ? `${lower.slice(0, -1)}a` : lower);
    return w.charAt(0) === w.charAt(0).toUpperCase() ? f.charAt(0).toUpperCase() + f.slice(1) : f;
  });
}

/** The position label in the reader's language, in the feminine in Spanish when it applies. */
export function positionLabel(p: Position, lang: 'en' | 'es', person: Parameters<typeof isWoman>[0]): string {
  return lang === 'es' && isWoman(person) ? feminineTitle(p.es) : p[lang];
}
