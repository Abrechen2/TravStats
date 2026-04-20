import { EARTH_RADIUS_KM, haversineKm } from '../haversine';

describe('haversineKm', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0);
    expect(haversineKm({ lat: 51.5, lon: -0.12 }, { lat: 51.5, lon: -0.12 })).toBe(0);
  });

  it('matches the known arc length for 1° of latitude at the equator', () => {
    // 1° of latitude ≈ πR/180 ≈ 111.19 km. Allow 0.5 km slack for rounding.
    const d = haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    const expected = (Math.PI * EARTH_RADIUS_KM) / 180;
    expect(Math.abs(d - expected)).toBeLessThan(0.5);
  });

  it('computes a reasonable transatlantic distance (HAM → JFK ~6100 km)', () => {
    const hamburg = { lat: 53.55, lon: 9.99 };
    const newYork = { lat: 40.64, lon: -73.78 };
    const d = haversineKm(hamburg, newYork);
    expect(d).toBeGreaterThan(5900);
    expect(d).toBeLessThan(6300);
  });

  it('is symmetric', () => {
    const a = { lat: 1, lon: 2 };
    const b = { lat: 3, lon: 4 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it('handles antipodes without NaN', () => {
    const d = haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 });
    expect(Number.isFinite(d)).toBe(true);
    // π * R — half the Earth's circumference.
    expect(Math.abs(d - Math.PI * EARTH_RADIUS_KM)).toBeLessThan(1);
  });
});
