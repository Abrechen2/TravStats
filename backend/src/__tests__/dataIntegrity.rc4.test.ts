/**
 * Issue #106 — data integrity hardening (RC4).
 *
 * Two related bug classes from nowi57's Iberia round-trip MUC↔MAD↔RAK:
 *   A) durationMinutes was computed for DATE_ONLY rows even though the time
 *      component is a 12:00 placeholder; combined with airport-timezone
 *      conversion the same-date round-trip produced 0/+120/-120 garbage.
 *   B) Free-text airline name ("Iberia") was not resolved to IATA/ICAO,
 *      so airline filters and codeshare detection couldn't see the row.
 *
 * Issues #103 and #104 are downstream symptoms of #106A; the chronology
 * test below covers the regression that update fails on negative duration.
 */
import { describe, it, expect } from '@jest/globals';
import { tzAwareDurationMinutes } from '../utils/timezone';
import { resolveAirlineCodes, normalizeAirline } from '../utils/airlineNormalize';
import { createFlightSchema, updateFlightSchema } from '../schemas/flight';

describe('#106A — tzAwareDurationMinutes returns null for DATE_ONLY', () => {
  // Use real UTC timestamps that mimic the post-tz-conversion state nowi57 hit:
  // dep RAK noon-local = 12:00 UTC (Africa/Casablanca had no DST 2009),
  // arr MAD noon-local = 10:00 UTC (Europe/Madrid CEST = UTC+2). Naïve diff
  // would say -120 min — which is what the bug report shows.
  const dep = new Date('2009-09-21T12:00:00Z');
  const arr = new Date('2009-09-21T10:00:00Z');

  it('returns null when both sides are DATE_ONLY', () => {
    expect(
      tzAwareDurationMinutes(dep, arr, 'Africa/Casablanca', 'Europe/Madrid', 'DATE_ONLY', 'DATE_ONLY'),
    ).toBeNull();
  });

  it('returns null when only depSemantics is DATE_ONLY', () => {
    expect(
      tzAwareDurationMinutes(dep, arr, 'Africa/Casablanca', 'Europe/Madrid', 'DATE_ONLY', 'UTC'),
    ).toBeNull();
  });

  it('returns null when only arrSemantics is DATE_ONLY', () => {
    expect(
      tzAwareDurationMinutes(dep, arr, 'Africa/Casablanca', 'Europe/Madrid', 'UTC', 'DATE_ONLY'),
    ).toBeNull();
  });

  it('still computes naïve diff when both sides are UTC', () => {
    expect(
      tzAwareDurationMinutes(dep, arr, 'Africa/Casablanca', 'Europe/Madrid', 'UTC', 'UTC'),
    ).toBe(-120); // we expose the raw value so callers can decide what to do
  });

  it('handles same-date 0-min DATE_ONLY without throwing', () => {
    // This is the MUC→MAD case: both 12:00 local in Europe/Berlin/Madrid
    // (same UTC offset) → naïve diff is 0. Still null with DATE_ONLY.
    const same = new Date('2009-09-14T10:00:00Z');
    expect(
      tzAwareDurationMinutes(same, same, 'Europe/Berlin', 'Europe/Madrid', 'DATE_ONLY', 'DATE_ONLY'),
    ).toBeNull();
  });
});

describe('#106B — resolveAirlineCodes (strict-exact)', () => {
  it('resolves "Iberia" → IB / IBE', () => {
    expect(resolveAirlineCodes('Iberia')).toEqual({
      iata: 'IB',
      icao: 'IBE',
      name: 'Iberia',
    });
  });

  it('resolves "iberia" (lowercase) → IB / IBE', () => {
    expect(resolveAirlineCodes('iberia')).toEqual({
      iata: 'IB',
      icao: 'IBE',
      name: 'Iberia',
    });
  });

  it('resolves "IB" (direct IATA) → IB / IBE', () => {
    expect(resolveAirlineCodes('IB')).toEqual({
      iata: 'IB',
      icao: 'IBE',
      name: 'Iberia',
    });
  });

  it('resolves "IBE" (direct ICAO) → IB / IBE', () => {
    expect(resolveAirlineCodes('IBE')).toEqual({
      iata: 'IB',
      icao: 'IBE',
      name: 'Iberia',
    });
  });

  it('resolves "Iberia Airlines" via NAME_TO_IATA alias → IB / IBE', () => {
    expect(resolveAirlineCodes('iberia airlines')).toEqual({
      iata: 'IB',
      icao: 'IBE',
      name: 'Iberia',
    });
  });

  it('resolves "Alitalia" → AZ (legacy name → ITA Airways successor)', () => {
    const r = resolveAirlineCodes('Alitalia');
    expect(r?.iata).toBe('AZ');
  });

  it('returns null for unknown airline names', () => {
    expect(resolveAirlineCodes('Nonexistent Airways')).toBeNull();
  });

  it('returns null for empty / whitespace input', () => {
    expect(resolveAirlineCodes('')).toBeNull();
    expect(resolveAirlineCodes('   ')).toBeNull();
  });

  it('does NOT substring-match — "Air India" must not resolve to "Indian"', () => {
    // Defensive: Codex-warned class of false-positives. If anything starts
    // matching "Air India" → some other airline's IATA, the strict-exact
    // contract has been broken.
    const r = resolveAirlineCodes('Indian Airlines');
    // Indian Airlines isn't in our list. Must NOT come back as "AI" / Air India.
    expect(r).toBeNull();
  });

  it('resolves "Lufthansa" → LH / DLH', () => {
    expect(resolveAirlineCodes('Lufthansa')).toEqual({
      iata: 'LH',
      icao: 'DLH',
      name: 'Lufthansa',
    });
  });

  it('preserves existing normalizeAirline alias behaviour', () => {
    // Sanity: the older spelling-only aliases still work.
    expect(normalizeAirline('egypt air')).toBe('EgyptAir');
  });
});

describe('#106A — chronology refine is granularity-aware', () => {
  // A round-trip RAK→MAD entered manually with DATE_ONLY mirrors arr to dep
  // → arrivalLocal "2009-09-21T12:00" === departureLocal "2009-09-21T12:00".
  // The OLD lex compare would also pass (==), but a typo arr-time < dep-time
  // would falsely fail. With granularity-aware comparison, only the date is
  // compared so any HH:mm noise within the same day is accepted.
  const baseFlight = {
    departure: { iata: 'RAK', lat: 31.6, lon: -8.0 },
    arrival: { iata: 'MAD', lat: 40.5, lon: -3.6 },
    departureLocal: '2009-09-21T12:00',
    arrivalLocal: '2009-09-21T10:00',
    depTimezone: 'Africa/Casablanca',
    arrTimezone: 'Europe/Madrid',
    status: 'historical' as const,
  };

  it('accepts same-day DATE_ONLY when arr time < dep time (placeholder noise)', () => {
    const result = createFlightSchema.safeParse({
      ...baseFlight,
      depTimeSemantics: 'DATE_ONLY' as const,
      arrTimeSemantics: 'DATE_ONLY' as const,
    });
    expect(result.success).toBe(true);
  });

  it('rejects DATE_ONLY when arrival date precedes departure date', () => {
    const result = createFlightSchema.safeParse({
      ...baseFlight,
      arrivalLocal: '2009-09-20T10:00', // one day earlier
      depTimeSemantics: 'DATE_ONLY' as const,
      arrTimeSemantics: 'DATE_ONLY' as const,
    });
    expect(result.success).toBe(false);
  });

  it('still rejects UTC rows where arrivalLocal < departureLocal', () => {
    const result = createFlightSchema.safeParse({
      ...baseFlight,
      depTimeSemantics: 'UTC' as const,
      arrTimeSemantics: 'UTC' as const,
    });
    expect(result.success).toBe(false);
  });

  it('updateFlightSchema applies the same date-only relaxation', () => {
    const result = updateFlightSchema.safeParse({
      departureLocal: '2009-09-21T12:00',
      arrivalLocal: '2009-09-21T10:00',
      depTimezone: 'Africa/Casablanca',
      arrTimezone: 'Europe/Madrid',
      depTimeSemantics: 'DATE_ONLY' as const,
      arrTimeSemantics: 'DATE_ONLY' as const,
    });
    expect(result.success).toBe(true);
  });
});
