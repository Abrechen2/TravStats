import { canonicalizeCompanionName, searchableCompanionName } from '../companionName';

describe('canonicalizeCompanionName', () => {
  it('collapses case, padding and inner whitespace to one identity', () => {
    const forms = ['Anna Müller', 'anna müller', '  Anna   Müller  ', 'ANNA MÜLLER'];
    const canonical = forms.map(canonicalizeCompanionName);
    expect(new Set(canonical).size).toBe(1);
  });

  // The rule that must never be "optimised" away: folding accents merges real
  // people, and once rows are linked that cannot be undone.
  it('keeps accented and unaccented spellings apart', () => {
    expect(canonicalizeCompanionName('José')).not.toBe(canonicalizeCompanionName('Jose'));
  });

  it('normalises unicode so visually identical names match', () => {
    const composed = 'José';        // é as one code point
    const decomposed = 'José';     // e + combining acute
    expect(canonicalizeCompanionName(composed)).toBe(canonicalizeCompanionName(decomposed));
  });

  it('returns an empty string for blank input', () => {
    expect(canonicalizeCompanionName('   ')).toBe('');
  });
});

describe('searchableCompanionName', () => {
  it('folds accents so search finds Muller when the name is Müller', () => {
    expect(searchableCompanionName('Müller')).toBe(searchableCompanionName('Muller'));
  });
});
