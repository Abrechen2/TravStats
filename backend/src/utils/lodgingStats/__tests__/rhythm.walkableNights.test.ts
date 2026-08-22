/**
 * `walkableNights` is the denominator the screen uses to decide whether nights
 * were double-booked: nights that can be placed on a calendar, minus the
 * distinct dates left after merging them, is the genuine overlap.
 *
 * It was first written as `stay.nights`, which is always undefined — the night
 * count lives on the WRAPPER (`StayWithNights.nights`), not on the stay. The
 * field stayed 0 for every account, so the overlap could never be reported at
 * all. The unit tests missed it because they set the number in a fixture; only
 * a real payload showed `nightsAway: 1` next to `walkableNights: 0`.
 */
import { computeRhythmStats } from '../rhythm';
import type { StayWithNights } from '../money';
import type { LodgingStayData } from '../types';

const NOW = new Date('2026-01-01T00:00:00Z');

function entry(checkIn: string, checkOut: string, nights: number): StayWithNights {
  const stay = {
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut),
    datePrecision: 'DAY',
    status: 'completed',
  } as unknown as LodgingStayData;
  return {
    stay,
    nights,
    timing: { walkable: true } as unknown as StayWithNights['timing'],
  };
}

describe('walkableNights', () => {
  it('counts the nights of a datable stay', () => {
    const r = computeRhythmStats([entry('2024-05-01', '2024-05-03', 2)], NOW);
    expect(r.nightsAway).toBe(2);
    expect(r.walkableNights).toBe(2);
  });

  it('equals nightsAway when nothing overlaps, so no overlap is reported', () => {
    const r = computeRhythmStats(
      [entry('2024-05-01', '2024-05-03', 2), entry('2024-06-01', '2024-06-03', 2)],
      NOW
    );
    expect(r.walkableNights - r.nightsAway).toBe(0);
  });

  it('exceeds nightsAway exactly by the nights booked twice', () => {
    // Two stays sharing the night of 1 May: four nights booked, three dates
    // actually spent away.
    const r = computeRhythmStats(
      [entry('2024-05-01', '2024-05-03', 2), entry('2024-04-30', '2024-05-02', 2)],
      NOW
    );
    expect(r.walkableNights).toBe(4);
    expect(r.nightsAway).toBe(3);
    expect(r.walkableNights - r.nightsAway).toBe(1);
  });

  it('leaves out a stay that cannot be placed on a calendar', () => {
    const undated: StayWithNights = {
      stay: { checkIn: null, checkOut: null, status: 'completed' } as unknown as LodgingStayData,
      nights: 5,
      timing: { walkable: false } as unknown as StayWithNights['timing'],
    };
    const r = computeRhythmStats([entry('2024-05-01', '2024-05-03', 2), undated], NOW);
    // The undated stay contributes to neither side, so it cannot masquerade as
    // an overlap — which is the bug this whole field exists to prevent.
    expect(r.walkableNights).toBe(2);
    expect(r.nightsAway).toBe(2);
  });
});
