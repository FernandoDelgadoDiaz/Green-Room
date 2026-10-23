import { describe, expect, it } from 'vitest';
import { detectTitleLanguage, languageProfile } from '../core/language';
import { runAgent } from '../core/agent/agent';
import { NoQlooAdapter } from '../core/qloo/mock';
import { DATASETS } from '../core/api';
import type { PodcastDataset } from '../core/types';

const ep = (id: string, title: string, guests: string[] = [], published = '2024-01-01T00:00:00.000Z') => ({ id, title, published, url: null, guests: guests.map((name) => ({ name, method: 'title-pattern' as const, confidence: 'high' as const })), excluded: false });
const mk = (id: string, language: string, episodes: ReturnType<typeof ep>[]): PodcastDataset => ({ id, name: id, host: 'H', hostAliases: ['H'], language, description: '', source: { feedUrl: '', website: '', retrievedAt: '', retrievedVia: '', note: '' }, episodes });

describe('episode language detection', () => {
  it('reads function words, and says nothing for bare names', () => {
    expect(detectTitleLanguage('Felipe Pigna: "Pareciera que todo es discutible, hasta que San Martín cruzó los Andes"')).toBe('es');
    expect(detectTitleLanguage('Why the future of AI is not what you think')).toBe('en');
    expect(detectTitleLanguage('#69 - Juliana Gattas')).toBeNull();
  });
});

describe('language profile of a show', () => {
  it('detects the habitual language with its share and confidence on real feeds', () => {
    const creativo = DATASETS.find((d) => d.id === 'creativo')!;
    const p = languageProfile(creativo, DATASETS.filter((d) => d.id !== 'creativo'));
    expect(p.basis).toBe('evidence');
    expect(p.accepted).toEqual(['es']);
    expect(p.shares[0].lang).toBe('es');
    expect(p.shares[0].share).toBeGreaterThan(0.9);
    expect(p.confidence).toBe('high');
  });

  it('accepts a second language only with enough evidence (≥15% and ≥3 episodes)', () => {
    const es = Array.from({ length: 10 }, (_, i) => ep(`e${i}`, `La historia de la vida y el mundo ${i}`));
    const en = Array.from({ length: 5 }, (_, i) => ep(`n${i}`, `The story of the world and how it works ${i}`));
    expect(languageProfile(mk('bi', 'es', [...es, ...en]), []).accepted).toEqual(['es', 'en']);
    expect(languageProfile(mk('mono', 'es', [...es, ...es.map((e) => ({ ...e, id: e.id + 'b' })), en[0]]), []).accepted).toEqual(['es']);
  });

  it('falls back to the declared language with low confidence, or unknown with nothing at all', () => {
    const names = Array.from({ length: 20 }, (_, i) => ep(`x${i}`, `#${i} - Person Number${i}`));
    const declared = languageProfile(mk('d', 'es', names), []);
    expect(declared).toMatchObject({ basis: 'declared', accepted: ['es'], confidence: 'low' });
    const unknown = languageProfile(mk('u', '', names), []);
    expect(unknown).toMatchObject({ basis: 'unknown', accepted: [] });
    expect(unknown.preference).toMatch(/unknown/);
  });

  it('records guests interviewed on shows in another language or country', () => {
    const a = mk('a', 'es', [ep('1', 'Ana Gómez: la vida en el mundo', ['Ana Gómez'])]);
    const b = mk('b', 'en', [ep('2', 'Ana Gómez on the world and life', ['Ana Gómez'])]);
    const p = languageProfile(a, [b], { originOf: new Map([['a', 'ar'], ['b', 'us']]) });
    expect(p.internationalGuests).toEqual([{ name: 'Ana Gómez', evidence: 'b (en) [US]' }]);
  });
});

describe('language compatibility of candidates uses the show’s habitual languages', () => {
  // Spanish show that also interviews in English (5 of 15 titles).
  const es = Array.from({ length: 10 }, (_, i) => ep(`e${i}`, `La historia de la ciencia y la vida ${i}`, [`Invitado Es${i}`]));
  const en = Array.from({ length: 5 }, (_, i) => ep(`n${i}`, `The story of science and how it works ${i}`, [`Guest En${i}`]));
  const bilingual = mk('bi', 'es', [...es, ...en]);
  const monolingual = mk('mono', 'es', es);
  const englishShow = mk('eng', 'en', [
    ep('x1', 'The science of the brain and how it works', ['Brain Scientist'], '2024-03-01T00:00:00.000Z'),
    ep('x2', 'The science of sleep and the brain', ['Brain Scientist'], '2024-03-05T00:00:00.000Z'),
  ]);

  it('an English-only interviewee counts as compatible for a show that also interviews in English', async () => {
    const r = await runAgent({ target: bilingual, others: [englishShow], qloo: new NoQlooAdapter(), asOf: '2024-06-01T00:00:00.000Z', k: 1 });
    expect(r.languageProfile.accepted).toEqual(['es', 'en']);
    expect(r.recommendations[0]).toMatchObject({ name: 'Brain Scientist', language: { status: 'confirmed', evidenceLanguages: ['en'] } });
  });

  it('but stays "unknown" (flagged, not removed) for a Spanish-only show', async () => {
    const r = await runAgent({ target: monolingual, others: [englishShow], qloo: new NoQlooAdapter(), asOf: '2024-06-01T00:00:00.000Z', k: 1 });
    expect(r.recommendations[0]).toMatchObject({ name: 'Brain Scientist', language: { status: 'unknown' } });
  });

  it('uses the language of the interview itself when its title is clear-cut', async () => {
    // An English interview published by a Spanish-language show.
    const mixed = mk('mixed', 'es', [ep('m1', 'Brain Scientist: the story of how the brain works and why we sleep', ['Brain Scientist'], '2024-03-01T00:00:00.000Z')]);
    const target = mk('t', 'en', Array.from({ length: 12 }, (_, i) => ep(`t${i}`, `The science of the brain and the mind ${i}`, [`Past ${i}`])));
    const r = await runAgent({ target, others: [mixed], qloo: new NoQlooAdapter(), asOf: '2024-06-01T00:00:00.000Z', k: 1 });
    expect(r.recommendations[0].language.status).toBe('confirmed');
  });
});
