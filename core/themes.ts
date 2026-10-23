// Theme inference from episode titles (INFERRED provenance). A small bilingual lexicon maps
// title words to ten broad themes. This is deliberately simple and transparent: it says what a show
// talks about according to its own titles, not what its listeners like.

import { stripAccents } from './names';

export const THEMES = {
  'ai-tech': { label: 'AI & Technology', labelEs: 'IA y tecnología', words: ['ai', 'artificial', 'intelligence', 'robot', 'robots', 'robotics', 'programming', 'coding', 'code', 'software', 'computer', 'computing', 'tech', 'technology', 'internet', 'crypto', 'bitcoin', 'blockchain', 'chatgpt', 'openai', 'agi', 'llm', 'llms', 'gpu', 'gpus', 'algorithm', 'algorithms', 'tecnologia', 'ia', 'inteligencia', 'datos', 'apple', 'tesla', 'meta', 'google', 'startup', 'startups', 'engineering'] },
  science: { label: 'Science & Space', labelEs: 'Ciencia y espacio', words: ['physics', 'quantum', 'universe', 'space', 'aliens', 'alien', 'ufo', 'ufos', 'mathematics', 'math', 'biology', 'evolution', 'cosmos', 'astronomy', 'science', 'scientist', 'planets', 'gravity', 'dna', 'genetics', 'chemistry', 'ciencia', 'universo', 'espacio', 'matematicas', 'fisica', 'ovnis', 'extraterrestres', 'astronauta', 'nuclear'] },
  'history-politics': { label: 'History & Politics', labelEs: 'Historia y política', words: ['history', 'war', 'wars', 'empire', 'empires', 'politics', 'political', 'president', 'democracy', 'putin', 'ukraine', 'russia', 'israel', 'china', 'iran', 'trump', 'civil', 'ancient', 'rome', 'roman', 'geopolitics', 'power', 'government', 'election', 'historia', 'guerra', 'politica', 'democracia', 'poder', 'mexico', 'elites', 'capitalism', 'communism', 'socialism', 'capitalismo'] },
  business: { label: 'Business & Money', labelEs: 'Negocios y dinero', words: ['business', 'money', 'wealth', 'rich', 'investing', 'investment', 'ceo', 'company', 'companies', 'entrepreneur', 'entrepreneurs', 'billion', 'million', 'millionaire', 'marketing', 'sales', 'brand', 'economy', 'economics', 'finance', 'negocio', 'negocios', 'dinero', 'empresa', 'emprender', 'exito', 'millonarios', 'invertir', 'economia', 'trading', 'banamex', 'corporativo', 'negociar'] },
  health: { label: 'Health & Body', labelEs: 'Salud y cuerpo', words: ['health', 'diet', 'food', 'sleep', 'fitness', 'longevity', 'aging', 'brain', 'hormones', 'testosterone', 'cancer', 'weight', 'fat', 'protein', 'exercise', 'gut', 'heart', 'disease', 'nutrition', 'supplements', 'salud', 'dieta', 'cuerpo', 'ejercicio', 'dormir', 'sueno', 'kilos', 'medicine'] },
  psychology: { label: 'Psychology & Mind', labelEs: 'Psicología y mente', words: ['psychology', 'mind', 'anxiety', 'depression', 'happiness', 'trauma', 'habits', 'mindset', 'mental', 'consciousness', 'ego', 'fear', 'confidence', 'motivation', 'discipline', 'addiction', 'adhd', 'emotions', 'therapy', 'terapia', 'ansiedad', 'depresion', 'mente', 'emociones', 'autoestima', 'miedo', 'miedos', 'psicotico', 'salud mental'] },
  philosophy: { label: 'Philosophy & Religion', labelEs: 'Filosofía y religión', words: ['philosophy', 'god', 'religion', 'meaning', 'free', 'will', 'truth', 'faith', 'christian', 'atheist', 'soul', 'death', 'life', 'existence', 'filosofia', 'dios', 'religion', 'espiritualidad', 'sentido', 'platon', 'kant', 'hume', 'logos', 'aforismos', 'divinidad', 'muerte'] },
  sports: { label: 'Sports & Competition', labelEs: 'Deportes y competencia', words: ['ufc', 'mma', 'fighting', 'fight', 'boxing', 'football', 'soccer', 'chess', 'olympic', 'olympics', 'nba', 'nfl', 'sports', 'sport', 'champion', 'climbing', 'futbol', 'box', 'ajedrez', 'mundial', 'deporte', 'pelea', 'pelear', 'cinturon', 'golfista', 'rayados', 'tigres', 'messi', 'var', 'poker'] },
  entertainment: { label: 'Music, Film & Comedy', labelEs: 'Música, cine y humor', words: ['music', 'song', 'songs', 'album', 'film', 'films', 'movie', 'movies', 'hollywood', 'comedy', 'comedian', 'actor', 'acting', 'tv', 'youtube', 'fame', 'rap', 'hip', 'hop', 'musica', 'musico', 'musicos', 'canciones', 'cine', 'pelicula', 'peliculas', 'comedia', 'comediantes', 'actuar', 'fama', 'banda', 'escenario', 'freestyle', 'influencer', 'influencers', 'redes'] },
  relationships: { label: 'Relationships & Family', labelEs: 'Relaciones y familia', words: ['love', 'relationships', 'relationship', 'dating', 'family', 'marriage', 'sex', 'parenting', 'parents', 'divorce', 'women', 'men', 'amor', 'relaciones', 'familia', 'pareja', 'hijos', 'hermano', 'mujeres', 'hombres', 'papa', 'luna de miel'] },
} as const;

export type ThemeId = keyof typeof THEMES;
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

const WORD_TO_THEMES = new Map<string, ThemeId[]>();
for (const id of THEME_IDS) {
  for (const w of THEMES[id].words) {
    const list = WORD_TO_THEMES.get(w) ?? [];
    list.push(id);
    WORD_TO_THEMES.set(w, list);
  }
}

export type ThemeVector = Record<ThemeId, number>;

export function emptyVector(): ThemeVector {
  return Object.fromEntries(THEME_IDS.map((id) => [id, 0])) as ThemeVector;
}

export function tokenize(text: string): string[] {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Theme hits for one title, plus the words that triggered them (kept as evidence). */
export function themesOfTitle(title: string, removeNames: string[] = []): { vector: ThemeVector; matched: Map<ThemeId, Set<string>> } {
  let t = title;
  for (const n of removeNames) t = t.split(n).join(' ');
  const vector = emptyVector();
  const matched = new Map<ThemeId, Set<string>>();
  for (const tok of tokenize(t)) {
    for (const id of WORD_TO_THEMES.get(tok) ?? []) {
      vector[id] += 1;
      if (!matched.has(id)) matched.set(id, new Set());
      matched.get(id)!.add(tok);
    }
  }
  return { vector, matched };
}

export function addInto(a: ThemeVector, b: ThemeVector, weight = 1): ThemeVector {
  for (const id of THEME_IDS) a[id] += b[id] * weight;
  return a;
}

export function cosine(a: ThemeVector, b: ThemeVector): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const id of THEME_IDS) {
    dot += a[id] * b[id];
    na += a[id] * a[id];
    nb += b[id] * b[id];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export function normalize(v: ThemeVector): ThemeVector {
  const total = THEME_IDS.reduce((s, id) => s + v[id], 0);
  const out = emptyVector();
  if (total === 0) return out;
  for (const id of THEME_IDS) out[id] = v[id] / total;
  return out;
}

export function topThemes(v: ThemeVector, n: number): Array<{ id: ThemeId; label: string; labelEs: string; share: number }> {
  const norm = normalize(v);
  return THEME_IDS.map((id) => ({ id, label: THEMES[id].label, labelEs: THEMES[id].labelEs, share: norm[id] }))
    .filter((t) => t.share > 0)
    .sort((a, b) => b.share - a.share)
    .slice(0, n);
}
