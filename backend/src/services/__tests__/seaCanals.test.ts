import { CANAL_OVERRIDES } from '../seaCanals';

describe('CANAL_OVERRIDES', () => {
  it('ships 15 canal/strait overrides — the Phase-2 baseline list', () => {
    expect(CANAL_OVERRIDES.length).toBe(15);
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
    for (const must of [
      'suez',
      'panama_atlantic',
      'panama_pacific',
      'kiel_west',
      'kiel_east',
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
  });
});
