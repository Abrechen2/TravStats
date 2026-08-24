import { describe, expect, it } from "vitest";
import {
  addFlightDuration,
  averageDurationMinutes,
  emptyDurationTotals,
  estimateDurationMinutes,
  resolveFlightDuration,
} from "../flightDuration";

/**
 * The SAME numbers as `backend/src/shared/__tests__/flightDuration.test.ts`.
 * A row's duration and the aggregate above it must agree; these two suites
 * disagreeing is the failure this mirror exists to catch.
 */
// MUC (48.35/11.79) → JFK (40.64/-73.78): ~6480 km great-circle.
const MUC = { lat: 48.3538, lon: 11.7861 };
const JFK = { lat: 40.6413, lon: -73.7781 };

describe('shared/flightDuration', () => {
  describe('estimateDurationMinutes', () => {
    it('estimates from the great circle plus ground overhead', () => {
      const est = estimateDurationMinutes(MUC.lat, MUC.lon, JFK.lat, JFK.lon);
      // ~6480 km / 800 km/h = ~8.1 h = ~486 min, + 15 min overhead.
      expect(est).not.toBeNull();
      expect(est!).toBeGreaterThan(470);
      expect(est!).toBeLessThan(520);
    });

    it('returns null when a coordinate is missing', () => {
      expect(estimateDurationMinutes(null, 11.78, 40.64, -73.77)).toBeNull();
      expect(estimateDurationMinutes(48.35, 11.78, 40.64, null)).toBeNull();
    });

    // An airport to itself is not a 15-minute flight. Without this guard the
    // overhead alone would be reported as a duration.
    it('returns null for a zero-length hop rather than the bare overhead', () => {
      expect(estimateDurationMinutes(MUC.lat, MUC.lon, MUC.lat, MUC.lon)).toBeNull();
    });
  });

  describe('resolveFlightDuration', () => {
    it('prefers a measured duration and marks it measured', () => {
      const d = resolveFlightDuration({
        measuredMinutes: 505,
        depLat: MUC.lat, depLon: MUC.lon, arrLat: JFK.lat, arrLon: JFK.lon,
      });
      expect(d).toEqual({ minutes: 505, estimated: false });
    });

    // The whole point of #268: a date-only row used to be 0 on the server and
    // an unlabelled estimate in the browser.
    it('falls back to an estimate and says so', () => {
      const d = resolveFlightDuration({
        measuredMinutes: null,
        depLat: MUC.lat, depLon: MUC.lon, arrLat: JFK.lat, arrLon: JFK.lon,
      });
      expect(d!.estimated).toBe(true);
      expect(d!.minutes).toBeGreaterThan(470);
    });

    it('treats a measured zero as no measurement, not as a zero-length flight', () => {
      const d = resolveFlightDuration({
        measuredMinutes: 0,
        depLat: MUC.lat, depLon: MUC.lon, arrLat: JFK.lat, arrLon: JFK.lon,
      });
      expect(d!.estimated).toBe(true);
    });

    it('answers null when there are neither times nor coordinates', () => {
      expect(
        resolveFlightDuration({
          measuredMinutes: null, depLat: null, depLon: null, arrLat: null, arrLon: null,
        }),
      ).toBeNull();
    });
  });

  describe('totals and average', () => {
    it('keeps measured and estimated apart inside one total', () => {
      let t = emptyDurationTotals();
      t = addFlightDuration(t, {
        measuredMinutes: 600,
        depLat: MUC.lat, depLon: MUC.lon, arrLat: JFK.lat, arrLon: JFK.lon,
      });
      t = addFlightDuration(t, {
        measuredMinutes: null,
        depLat: MUC.lat, depLon: MUC.lon, arrLat: JFK.lat, arrLon: JFK.lon,
      });
      expect(t.measuredCount).toBe(1);
      expect(t.estimatedCount).toBe(1);
      expect(t.measuredMinutes).toBe(600);
      expect(t.estimatedMinutes).toBeGreaterThan(0);
      expect(t.totalMinutes).toBe(t.measuredMinutes + t.estimatedMinutes);
    });

    it('counts a row it cannot answer for without dragging the total down', () => {
      let t = emptyDurationTotals();
      t = addFlightDuration(t, {
        measuredMinutes: 600,
        depLat: MUC.lat, depLon: MUC.lon, arrLat: JFK.lat, arrLon: JFK.lon,
      });
      t = addFlightDuration(t, {
        measuredMinutes: null, depLat: null, depLon: null, arrLat: null, arrLon: null,
      });
      expect(t.unknownCount).toBe(1);
      expect(t.totalMinutes).toBe(600);
    });

    // The overview divided by ALL flights, the business block by flights with
    // real times, and both carried the identical German label.
    it('divides by what contributed, not by every flight', () => {
      let t = emptyDurationTotals();
      t = addFlightDuration(t, {
        measuredMinutes: 600,
        depLat: MUC.lat, depLon: MUC.lon, arrLat: JFK.lat, arrLon: JFK.lon,
      });
      t = addFlightDuration(t, {
        measuredMinutes: null, depLat: null, depLon: null, arrLat: null, arrLon: null,
      });
      expect(averageDurationMinutes(t)).toBe(600);
    });

    it('answers null rather than zero when nothing contributed', () => {
      expect(averageDurationMinutes(emptyDurationTotals())).toBeNull();
    });
  });
});
