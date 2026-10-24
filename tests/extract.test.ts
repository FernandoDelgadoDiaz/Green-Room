import { describe, expect, it } from 'vitest';
import { extractGenericGuests } from '../core/extract-generic';
import { extractCreativoGuests, extractDoacGuests, extractLexGuests, doacExclusion, isCreativoRerun } from '../core/extract';
import { nameKey, sameName } from '../core/names';

const names = (g: { name: string }[]) => g.map((x) => x.name);

describe('Lex Fridman titles (real examples from the feed)', () => {
  it('reads "Name: topics"', () => {
    expect(names(extractLexGuests('#383 – Mark Zuckerberg: Future of AI at Meta, Facebook, Instagram, and WhatsApp', ''))).toEqual(['Mark Zuckerberg']);
  });
  it('reads "topics – Name"', () => {
    expect(names(extractLexGuests('#488 – Infinity, Paradoxes that Broke Mathematics, Gödel Incompleteness & the Multiverse – Joel David Hamkins', ''))).toEqual(['Joel David Hamkins']);
  });
  it('falls back to the description first sentence', () => {
    expect(names(extractLexGuests('#502 – Psychiatry, Insane Asylums, Mental Illness, ECT, Lobotomies, Freud & Jung', '<p>Andrew Scull is a historian of psychiatry.</p>'))).toEqual(['Andrew Scull']);
  });
  it('returns nothing rather than guessing', () => {
    expect(extractLexGuests('#496 – FFmpeg: The Incredible Technology Behind Video on the Internet', '<p>Thank you for listening</p>')).toEqual([]);
  });
});

describe('Diary Of A CEO titles', () => {
  it('reads the trailing "| Name" slot and strips Dr', () => {
    expect(names(extractDoacGuests('The Attention Span Doctor: Stop Doing This At Work, It Costs You 2 Hours A Day! | Dr Sahar Yousef'))).toEqual(['Sahar Yousef']);
  });
  it('reads a leading name', () => {
    expect(names(extractDoacGuests('Rainn Wilson: "I was so unhappy during The Office!" (Dwight Schrute)'))).toEqual(['Rainn Wilson']);
  });
  it('does not treat roles as names', () => {
    expect(extractDoacGuests('Klarna Founder: From $0 to $46 Billion')).toEqual([]);
    expect(extractDoacGuests('Human Lie Detector: How To Tell If Someone Is Lying')).toEqual([]);
    expect(extractDoacGuests('The Deathbed Doctor: Modern Hospitals Are Destroying Your Final Days!')).toEqual([]);
  });
  it('excludes clip re-runs', () => {
    expect(doacExclusion('Most Replayed Moment: Christian vs Atheist - Is Faith A Human Creation?')).not.toBeNull();
  });
});

describe('CREATIVO titles (Spanish)', () => {
  it('reads the uppercase name slot', () => {
    expect(names(extractCreativoGuests('683. JAVIER PANIAGUA | El Músico Es Víctima de su Propia Industria'))).toEqual(['Javier Paniagua']);
  });
  it('keeps a duo name together and splits two full names', () => {
    expect(names(extractCreativoGuests('642. MAU Y RICKY | Trabajar Con Tu Hermano Sin Hundirte en el Intento'))).toEqual(['Mau Y Ricky']);
    expect(names(extractCreativoGuests('622. GUSTAVO SANTAOLALLA Y JUAN CAMPODÓNICO | Bajofondo'))).toEqual(['Gustavo Santaolalla', 'Juan Campodónico']);
  });
  it('reads a trailing guest after a question', () => {
    expect(names(extractCreativoGuests('679. ¿Regresas el Carrito del Súper? | Andreas Östberg'))).toEqual(['Andreas Östberg']);
  });
  it('ignores host-only episodes', () => {
    expect(extractCreativoGuests('671. TERMINÉ Mi Viaje por JAPÓN y No Estoy Bien')).toEqual([]);
  });
  it('detects re-uploads', () => {
    expect(isCreativoRerun('EL TREN (2023) | ¿Tu teléfono te espía?')).toBe(true);
    expect(isCreativoRerun('673. EL TREN | Al Dinero le Quedan 15 Años')).toBe(false);
  });
});

describe('name matching', () => {
  it('ignores accents, case and honorifics', () => {
    expect(sameName('Mateus Ruzzarín', 'MATEUS RUZZARIN')).toBe(true);
    expect(sameName('Dr. Andrew Huberman', 'Andrew Huberman')).toBe(true);
    expect(nameKey('Ricardo O’Farrill')).toBe(nameKey("Ricardo O'farrill"));
  });
  it('does not merge different people', () => {
    expect(sameName('Eric Weinstein', 'Bret Weinstein')).toBe(false);
  });
});

describe('generic extraction: "Name sobre/about topic"', () => {
  const g = (t: string) => extractGenericGuests(t, ['Gustavo Noriega'], 'Conversaciones').map((x) => x.name);
  it('takes the speaker before "sobre", never names inside the topic', () => {
    expect(g('Horacio Tarcus sobre sus charlas con Ricardo Piglia')).toEqual(['Horacio Tarcus']);
    expect(g('Cayetana Vidal Buzzi y Silvina Reusmann sobre "Morfi Porteño"')).toEqual(['Cayetana Vidal Buzzi', 'Silvina Reusmann']);
    expect(g('Con Esther Wolf y Paula Labeur sobre "Tenemos Química".')).toEqual(['Esther Wolf', 'Paula Labeur']);
    expect(g('Christian Ferrer sobre "Malvinas Memories"')).not.toContain('Malvinas Memories');
  });
});
