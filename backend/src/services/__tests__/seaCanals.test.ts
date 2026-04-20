import { CANAL_OVERRIDES } from '../seaCanals';

describe('CANAL_OVERRIDES', () => {
  it('ships 13 canal/strait overrides — Phase-2 baseline minus Kiel Canal', () => {
    // 15 original Phase-2 entries minus kiel_west + kiel_east (dropped
    // because big cruise ships can't use the Nord-Ostsee-Kanal).
    expect(CANAL_OVERRIDES.length).toBe(13);
  });

  it('has unique ids', () => {
    const ids = CANAL_OVERRIDES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('anchors are valid geographic coordinates', () => {
    for (const c of CANAL_OVERRIDES) {
      expect(c.anchor.lat).toBeGreaterThanOrEqual(-90);
      expect(c.anchor.lat).toBeLessThanOrEqual(90);
      expect(c.anchor.lon).toBeGreaterThanOrEqual(-180);
      expect(c.anchor.lon).toBeLessThanOrEqual(180);
    }
  });

  it('axes have at least two points so A* can trace a path', () => {
    for (const c of CANAL_OVERRIDES) {
      expect(c.axis.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('covers the mainstream cruise canals by name', () => {
    const ids = CANAL_OVERRIDES.map((c) => c.id);
    // Spot-check the must-haves; full list lives in the module.
    // Kiel Canal is intentionally NOT on this list — big cruise ships
    // exceed its 235 m length limit and cannot transit, so we route
    // around Jütland instead (see seaCanals.ts comment).
    for (const must of [
      'suez',
      'panama_atlantic',
      'panama_pacific',
      'corinth',
      'bosporus',
      'dardanelles',
      'bab_el_mandeb',
      'hormuz',
      'malacca',
      'sunda',
      'great_belt',
      'oresund',
      'cape_cod',
    ]) {
      expect(ids).toContain(must);
    }
    // Keep Kiel out explicitly so future additions don't sneak it back in.
    expect(ids).not.toContain('kiel_west');
    expect(ids).not.toContain('kiel_east');
  });
});
