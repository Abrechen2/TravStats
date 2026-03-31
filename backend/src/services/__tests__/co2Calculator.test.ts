import { calculateCo2Kg, CABIN_FACTORS } from '../co2Calculator';

describe('calculateCo2Kg', () => {
  it('returns null when depLat is null', () => {
    expect(calculateCo2Kg({ depLat: null, depLon: 8.571, arrLat: 48.354, arrLon: 11.786, seatClass: null })).toBeNull();
  });

  it('returns null when arrLat is null', () => {
    expect(calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: null, arrLon: null, seatClass: null })).toBeNull();
  });

  it('calculates economy CO₂ for short haul (FRA→MUC ~300km)', () => {
    const kg = calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: 48.354, arrLon: 11.786, seatClass: 'economy' });
    expect(kg).not.toBeNull();
    expect(kg!).toBeGreaterThan(50);
    expect(kg!).toBeLessThan(120);
  });

  it('calculates business CO₂ as ~2.9× economy for same route', () => {
    const eco = calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: 48.354, arrLon: 11.786, seatClass: 'economy' })!;
    const biz = calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: 48.354, arrLon: 11.786, seatClass: 'business' })!;
    expect(biz / eco).toBeCloseTo(CABIN_FACTORS.business / CABIN_FACTORS.economy, 1);
  });

  it('uses long-haul factor for FRA→JFK (~6200km)', () => {
    const kg = calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: 40.640, arrLon: -73.779, seatClass: 'economy' })!;
    expect(kg).toBeGreaterThan(800);
    expect(kg).toBeLessThan(1800);
  });

  it('defaults to economy when seatClass is null', () => {
    const withNull = calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: 48.354, arrLon: 11.786, seatClass: null });
    const withEco  = calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: 48.354, arrLon: 11.786, seatClass: 'economy' });
    expect(withNull).toBe(withEco);
  });

  it('returns a positive integer', () => {
    const kg = calculateCo2Kg({ depLat: 50.033, depLon: 8.571, arrLat: 48.354, arrLon: 11.786, seatClass: 'first' })!;
    expect(Number.isInteger(kg)).toBe(true);
    expect(kg).toBeGreaterThan(0);
  });
});
