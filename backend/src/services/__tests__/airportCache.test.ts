import { compareAirportAuthority } from '../airportCache';

describe('compareAirportAuthority — IATA/ICAO collision ranking', () => {
  const ivato = { icao: 'FMMI', isClosed: false }; // real ICAO (Antananarivo)
  const tulsaAirpark = { icao: 'US-0226', isClosed: false }; // synthetic placeholder

  it('ranks a real 4-letter ICAO above an OurAirports US-#### placeholder', () => {
    const sorted = [tulsaAirpark, ivato].sort(compareAirportAuthority);
    expect(sorted[0]).toBe(ivato);
  });

  it('is order-independent (placeholder first input still loses)', () => {
    const sorted = [ivato, tulsaAirpark].sort(compareAirportAuthority);
    expect(sorted[0].icao).toBe('FMMI');
  });

  it('ranks an active airport above a closed one', () => {
    const active = { icao: 'EDDM', isClosed: false };
    const closed = { icao: 'EDDM', isClosed: true };
    const sorted = [closed, active].sort(compareAirportAuthority);
    expect(sorted[0]).toBe(active);
  });

  it('prefers active real-ICAO over an active placeholder before considering closure', () => {
    // Active placeholder vs active real ICAO → real ICAO wins.
    const sorted = [tulsaAirpark, ivato].sort(compareAirportAuthority);
    expect(sorted[0].icao).toBe('FMMI');
  });

  it('treats two real ICAOs as equal (stable, no spurious reorder)', () => {
    const a = { icao: 'KSFO', isClosed: false };
    const b = { icao: 'KLAX', isClosed: false };
    expect(compareAirportAuthority(a, b)).toBe(0);
  });

  it('handles a null ICAO as non-placeholder (ranks with real ICAOs)', () => {
    const noIcao = { icao: null, isClosed: false };
    expect(compareAirportAuthority(noIcao, { icao: 'US-9999', isClosed: false })).toBeLessThan(0);
  });
});
