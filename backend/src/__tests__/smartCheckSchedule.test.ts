/**
 * Unit tests for smart API check scheduling.
 * Covers the 3-checkpoint lifecycle: pre-departure, pre-arrival, post-arrival.
 */

import { calculateNextApiCheckAt } from '../utils/smartCheckSchedule';

const MINUTES = 60 * 1000;
const HOURS = 60 * MINUTES;

/** Fixed "now" for deterministic tests */
const NOW = new Date('2026-05-01T10:00:00.000Z');

function future(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

describe('calculateNextApiCheckAt', () => {
  describe('eligibility gates', () => {
    it('returns null without a flight number', () => {
      expect(calculateNextApiCheckAt(future(2 * HOURS), future(5 * HOURS), 'scheduled', null, NOW))
        .toBeNull();
    });

    it('returns null for non-scheduled statuses', () => {
      expect(calculateNextApiCheckAt(future(2 * HOURS), future(5 * HOURS), 'flown', 'LH400', NOW))
        .toBeNull();
      expect(calculateNextApiCheckAt(future(2 * HOURS), future(5 * HOURS), 'cancelled', 'LH400', NOW))
        .toBeNull();
      expect(calculateNextApiCheckAt(future(2 * HOURS), future(5 * HOURS), 'historical', 'LH400', NOW))
        .toBeNull();
    });

    it('returns null without a departure time', () => {
      expect(calculateNextApiCheckAt(null, future(5 * HOURS), 'scheduled', 'LH400', NOW))
        .toBeNull();
    });
  });

  describe('3-checkpoint schedule', () => {
    it('returns the pre-departure checkpoint (dep - 30 min) when departure is far in the future', () => {
      const dep = future(5 * HOURS);
      const arr = future(12 * HOURS);
      const result = calculateNextApiCheckAt(dep, arr, 'scheduled', 'LH400', NOW);
      expect(result?.getTime()).toBe(dep.getTime() - 30 * MINUTES);
    });

    it('skips to pre-arrival once we are past the pre-departure checkpoint', () => {
      // Departure is in 10 minutes — pre-departure (dep - 30min) is already in the past
      const dep = future(10 * MINUTES);
      const arr = future(5 * HOURS);
      const result = calculateNextApiCheckAt(dep, arr, 'scheduled', 'LH400', NOW);
      expect(result?.getTime()).toBe(arr.getTime() - 60 * MINUTES);
    });

    it('skips to post-arrival once we are past the pre-arrival checkpoint', () => {
      // Arrival is in 30 minutes — pre-arrival (arr - 60min) is already in the past
      const dep = future(-3 * HOURS);
      const arr = future(30 * MINUTES);
      const result = calculateNextApiCheckAt(dep, arr, 'scheduled', 'LH400', NOW);
      expect(result?.getTime()).toBe(arr.getTime() + 30 * MINUTES);
    });

    it('returns null once all three checkpoints are in the past', () => {
      // Flight arrived 2 hours ago
      const dep = future(-5 * HOURS);
      const arr = future(-2 * HOURS);
      const result = calculateNextApiCheckAt(dep, arr, 'scheduled', 'LH400', NOW);
      expect(result).toBeNull();
    });
  });

  describe('arrival-time fallback', () => {
    it('synthesizes arrival = departure + 12h when arrivalTime is missing', () => {
      const dep = future(5 * HOURS);
      const result = calculateNextApiCheckAt(dep, null, 'scheduled', 'LH400', NOW);
      // First checkpoint is still pre-departure
      expect(result?.getTime()).toBe(dep.getTime() - 30 * MINUTES);
    });

    it('still terminates even without an explicit arrival', () => {
      // Departure was 15h ago — fallback arrival (dep + 12h) was 3h ago,
      // post-arrival (arr + 30min) was 2.5h ago → all past → null
      const dep = future(-15 * HOURS);
      const result = calculateNextApiCheckAt(dep, null, 'scheduled', 'LH400', NOW);
      expect(result).toBeNull();
    });
  });

  describe('arrival follow-up (delayed flights)', () => {
    // The three fixed checkpoints derive from SCHEDULED times, so the last one
    // sits at scheduled arrival + 30 min. A flight delayed by more than that is
    // still airborne when it fires, and without a follow-up its actual_arrival
    // could never be captured (observed on LO729 WAW-EVN, 2026-07-21).
    it('keeps polling when a departure was observed but no arrival was', () => {
      const dep = future(-5 * HOURS);
      const arr = future(-2 * HOURS); // all three checkpoints already past
      const result = calculateNextApiCheckAt(dep, arr, 'scheduled', 'LO729', NOW, {
        hasActualDeparture: true,
        hasActualArrival: false,
      });
      expect(result?.getTime()).toBe(NOW.getTime() + 30 * MINUTES);
    });

    it('stops as soon as the arrival has been observed', () => {
      const dep = future(-5 * HOURS);
      const arr = future(-2 * HOURS);
      const result = calculateNextApiCheckAt(dep, arr, 'scheduled', 'LO729', NOW, {
        hasActualDeparture: true,
        hasActualArrival: true,
      });
      expect(result).toBeNull();
    });

    it('does not follow up on a flight that was never observed departing', () => {
      const dep = future(-5 * HOURS);
      const arr = future(-2 * HOURS);
      const result = calculateNextApiCheckAt(dep, arr, 'scheduled', 'LH400', NOW, {
        hasActualDeparture: false,
        hasActualArrival: false,
      });
      expect(result).toBeNull();
    });

    it('gives up once the follow-up window (arrival + 6h) has closed', () => {
      const dep = future(-10 * HOURS);
      const arr = future(-7 * HOURS); // deadline was an hour ago
      const result = calculateNextApiCheckAt(dep, arr, 'scheduled', 'LO729', NOW, {
        hasActualDeparture: true,
        hasActualArrival: false,
      });
      expect(result).toBeNull();
    });

    it('clamps the final follow-up to the window deadline', () => {
      const dep = future(-9 * HOURS);
      const arr = future(-5 * HOURS - 45 * MINUTES); // deadline is in 15 min
      const result = calculateNextApiCheckAt(dep, arr, 'scheduled', 'LO729', NOW, {
        hasActualDeparture: true,
        hasActualArrival: false,
      });
      expect(result?.getTime()).toBe(arr.getTime() + 6 * HOURS);
    });

    it('leaves the normal checkpoint chain untouched while checkpoints remain', () => {
      const dep = future(5 * HOURS);
      const arr = future(12 * HOURS);
      const result = calculateNextApiCheckAt(dep, arr, 'scheduled', 'LH400', NOW, {
        hasActualDeparture: true,
        hasActualArrival: false,
      });
      expect(result?.getTime()).toBe(dep.getTime() - 30 * MINUTES);
    });
  });

  describe('short-haul edge cases', () => {
    it('deduplicates / orders checkpoints correctly on ultra-short flights', () => {
      // 55 min MUC-VIE flight: dep in 2h, arr in 2h55min.
      // Pre-dep (dep-30m) = +1h30, Pre-arr (arr-60m) = +1h55, Post-arr (arr+30m) = +3h25.
      // The ordering must stay ascending.
      const dep = future(2 * HOURS);
      const arr = future(2 * HOURS + 55 * MINUTES);
      const result = calculateNextApiCheckAt(dep, arr, 'scheduled', 'OS112', NOW);
      expect(result?.getTime()).toBe(dep.getTime() - 30 * MINUTES);
    });
  });
});
