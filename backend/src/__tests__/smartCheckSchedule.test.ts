/**
 * Unit tests for smart API check scheduling.
 * Covers the lifecycle: the day before (T-24 h), the last three hours before
 * departure on a 15-minute grid (TravStats#156 — a gate or time change has to
 * reach the phone before the passenger is at the airport), pre-departure,
 * pre-arrival, post-arrival.
 */

import { calculateNextApiCheckAt } from "../utils/smartCheckSchedule";

const MINUTES = 60 * 1000;
const HOURS = 60 * MINUTES;

/** Fixed "now" for deterministic tests */
const NOW = new Date("2026-05-01T10:00:00.000Z");

function future(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

describe("calculateNextApiCheckAt", () => {
  describe("eligibility gates", () => {
    it("returns null without a flight number", () => {
      expect(
        calculateNextApiCheckAt(future(2 * HOURS), future(5 * HOURS), "scheduled", null, NOW)
      ).toBeNull();
    });

    it("returns null for non-scheduled statuses", () => {
      expect(
        calculateNextApiCheckAt(future(2 * HOURS), future(5 * HOURS), "flown", "LH400", NOW)
      ).toBeNull();
      expect(
        calculateNextApiCheckAt(future(2 * HOURS), future(5 * HOURS), "cancelled", "LH400", NOW)
      ).toBeNull();
      expect(
        calculateNextApiCheckAt(future(2 * HOURS), future(5 * HOURS), "historical", "LH400", NOW)
      ).toBeNull();
    });

    it("returns null without a departure time", () => {
      expect(
        calculateNextApiCheckAt(null, future(5 * HOURS), "scheduled", "LH400", NOW)
      ).toBeNull();
    });
  });

  describe("3-checkpoint schedule", () => {
    // Was "dep - 30 min" while only three checkpoints existed; since
    // TravStats#156 the next check five hours out is T-3h.
    it("returns T-3h when departure is five hours away", () => {
      const dep = future(5 * HOURS);
      const arr = future(12 * HOURS);
      const result = calculateNextApiCheckAt(dep, arr, "scheduled", "LH400", NOW);
      expect(result?.getTime()).toBe(dep.getTime() - 3 * HOURS);
    });

    it("looks once 30 min after departure, so the takeoff is known in the air (forgejo#195)", () => {
      // Departure is in 10 minutes — pre-departure (dep - 30min) is already in the past
      const dep = future(10 * MINUTES);
      const arr = future(5 * HOURS);
      const result = calculateNextApiCheckAt(dep, arr, "scheduled", "LH400", NOW);
      expect(result?.getTime()).toBe(dep.getTime() + 30 * MINUTES);
    });

    it("skips to pre-arrival once the post-departure check is past", () => {
      const dep = future(-40 * MINUTES);
      const arr = future(10 * HOURS);
      const result = calculateNextApiCheckAt(dep, arr, "scheduled", "LH718", NOW);
      expect(result?.getTime()).toBe(arr.getTime() - 60 * MINUTES);
    });

    it("skips to post-arrival once we are past the pre-arrival checkpoint", () => {
      // Arrival is in 30 minutes — pre-arrival (arr - 60min) is already in the past
      const dep = future(-3 * HOURS);
      const arr = future(30 * MINUTES);
      const result = calculateNextApiCheckAt(dep, arr, "scheduled", "LH400", NOW);
      expect(result?.getTime()).toBe(arr.getTime() + 30 * MINUTES);
    });

    it("returns null once all three checkpoints are in the past", () => {
      // Flight arrived 2 hours ago
      const dep = future(-5 * HOURS);
      const arr = future(-2 * HOURS);
      const result = calculateNextApiCheckAt(dep, arr, "scheduled", "LH400", NOW);
      expect(result).toBeNull();
    });
  });

  describe("arrival-time fallback", () => {
    it("synthesizes arrival = departure + 12h when arrivalTime is missing", () => {
      const dep = future(5 * HOURS);
      const result = calculateNextApiCheckAt(dep, null, "scheduled", "LH400", NOW);
      // First checkpoint is still a pre-departure one (T-3h since TravStats#156)
      expect(result?.getTime()).toBe(dep.getTime() - 3 * HOURS);
    });

    it("still terminates even without an explicit arrival", () => {
      // Departure was 15h ago — fallback arrival (dep + 12h) was 3h ago,
      // post-arrival (arr + 30min) was 2.5h ago → all past → null
      const dep = future(-15 * HOURS);
      const result = calculateNextApiCheckAt(dep, null, "scheduled", "LH400", NOW);
      expect(result).toBeNull();
    });
  });

  describe("arrival follow-up (delayed flights)", () => {
    // The three fixed checkpoints derive from SCHEDULED times, so the last one
    // sits at scheduled arrival + 30 min. A flight delayed by more than that is
    // still airborne when it fires, and without a follow-up its actual_arrival
    // could never be captured (observed on LO729 WAW-EVN, 2026-07-21).
    it("keeps polling when a departure was observed but no arrival was", () => {
      const dep = future(-5 * HOURS);
      const arr = future(-2 * HOURS); // all three checkpoints already past
      const result = calculateNextApiCheckAt(dep, arr, "scheduled", "LO729", NOW, {
        hasActualDeparture: true,
        hasActualArrival: false,
      });
      expect(result?.getTime()).toBe(NOW.getTime() + 30 * MINUTES);
    });

    it("stops as soon as the arrival has been observed", () => {
      const dep = future(-5 * HOURS);
      const arr = future(-2 * HOURS);
      const result = calculateNextApiCheckAt(dep, arr, "scheduled", "LO729", NOW, {
        hasActualDeparture: true,
        hasActualArrival: true,
      });
      expect(result).toBeNull();
    });

    it("does not follow up on a flight that was never observed departing", () => {
      const dep = future(-5 * HOURS);
      const arr = future(-2 * HOURS);
      const result = calculateNextApiCheckAt(dep, arr, "scheduled", "LH400", NOW, {
        hasActualDeparture: false,
        hasActualArrival: false,
      });
      expect(result).toBeNull();
    });

    it("gives up once the follow-up window (arrival + 6h) has closed", () => {
      const dep = future(-10 * HOURS);
      const arr = future(-7 * HOURS); // deadline was an hour ago
      const result = calculateNextApiCheckAt(dep, arr, "scheduled", "LO729", NOW, {
        hasActualDeparture: true,
        hasActualArrival: false,
      });
      expect(result).toBeNull();
    });

    it("clamps the final follow-up to the window deadline", () => {
      const dep = future(-9 * HOURS);
      const arr = future(-5 * HOURS - 45 * MINUTES); // deadline is in 15 min
      const result = calculateNextApiCheckAt(dep, arr, "scheduled", "LO729", NOW, {
        hasActualDeparture: true,
        hasActualArrival: false,
      });
      expect(result?.getTime()).toBe(arr.getTime() + 6 * HOURS);
    });

    it("leaves the normal checkpoint chain untouched while checkpoints remain", () => {
      const dep = future(5 * HOURS);
      const arr = future(12 * HOURS);
      const result = calculateNextApiCheckAt(dep, arr, "scheduled", "LH400", NOW, {
        hasActualDeparture: true,
        hasActualArrival: false,
      });
      // The fixed chain still wins over follow-ups (T-3h since TravStats#156)
      expect(result?.getTime()).toBe(dep.getTime() - 3 * HOURS);
    });
  });

  describe("short-haul edge cases", () => {
    it("deduplicates / orders checkpoints correctly on ultra-short flights", () => {
      // 55 min MUC-VIE flight: dep in 2h, arr in 2h55min. Inside the last
      // three hours the 15-minute grid runs (+15m is the first future point);
      // pre-arrival (arr-60m = +1h55) and post-arrival follow in order.
      const dep = future(2 * HOURS);
      const arr = future(2 * HOURS + 55 * MINUTES);
      const result = calculateNextApiCheckAt(dep, arr, "scheduled", "OS112", NOW);
      expect(result?.getTime()).toBe(NOW.getTime() + 15 * MINUTES);
      const all: number[] = [];
      let at = NOW;
      for (let i = 0; i < 40; i++) {
        const next = calculateNextApiCheckAt(dep, arr, "scheduled", "OS112", at);
        if (!next) break;
        all.push(next.getTime());
        at = next;
      }
      expect([...all].sort((a, b) => a - b)).toEqual(all);
      expect(all).toContain(arr.getTime() - 60 * MINUTES);
      expect(all[all.length - 1]).toBe(arr.getTime() + 30 * MINUTES);
    });
  });

  describe("earlier checks for push (TravStats#156)", () => {
    it("checks the day before: T-24h when departure is 30 hours away", () => {
      const dep = future(30 * HOURS);
      const result = calculateNextApiCheckAt(dep, future(40 * HOURS), "scheduled", "LH712", NOW);
      expect(result?.getTime()).toBe(dep.getTime() - 24 * HOURS);
    });

    it("then T-3h", () => {
      const dep = future(20 * HOURS);
      const result = calculateNextApiCheckAt(dep, future(30 * HOURS), "scheduled", "LH712", NOW);
      expect(result?.getTime()).toBe(dep.getTime() - 3 * HOURS);
    });

    it("then every 15 minutes until departure", () => {
      const dep = future(3 * HOURS - 1 * MINUTES); // T-3h was a minute ago
      const result = calculateNextApiCheckAt(dep, future(10 * HOURS), "scheduled", "LH712", NOW);
      expect(result?.getTime()).toBe(dep.getTime() - 2 * HOURS - 45 * MINUTES);
    });

    it("keeps the existing dep-30m checkpoint inside the grid", () => {
      const dep = future(40 * MINUTES);
      const result = calculateNextApiCheckAt(dep, future(10 * HOURS), "scheduled", "LH712", NOW);
      expect(result?.getTime()).toBe(dep.getTime() - 30 * MINUTES);
    });

    it("never schedules a pre-departure check at or after departure", () => {
      // The 15-minute grid stops before departure; the next look is the single
      // post-departure check (forgejo#195), not another grid step.
      const dep = future(10 * MINUTES);
      const arr = future(5 * HOURS);
      const result = calculateNextApiCheckAt(dep, arr, "scheduled", "LH712", NOW);
      expect(result?.getTime()).toBe(dep.getTime() + 30 * MINUTES);
    });
  });
});
