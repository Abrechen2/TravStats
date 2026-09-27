import { describe, expect, it } from "vitest";

import { editsOwnPoints, tourPointsSaveErrorKey } from "../tourPointsSave";
import type { TourStop } from "../../../types/tour";

const stop = (tripId: string | null): TourStop => ({
  id: `s-${tripId ?? "own"}`,
  title: "P",
  lat: 1,
  lon: 1,
  routeOrderIdx: 0,
  tripId,
});

describe("editsOwnPoints (acceptance D5)", () => {
  it("edits a standalone tour's points, and a joined day tour's own points", () => {
    expect(editsOwnPoints(false, [])).toBe(true);
    expect(editsOwnPoints(true, [stop(null), stop(null)])).toBe(true);
  });

  it("leaves a section built from the trip's timeline, or an empty one, to the assigner", () => {
    expect(editsOwnPoints(true, [stop("t1")])).toBe(false);
    expect(editsOwnPoints(true, [])).toBe(false);
  });
});

describe("tourPointsSaveErrorKey — a refused save in the reader's words", () => {
  const refused = (status: number, code?: string): unknown => ({
    response: { status, data: { error: "English prose", ...(code ? { code } : {}) } },
  });

  it("names each cause, never the server's English", () => {
    expect(tourPointsSaveErrorKey(refused(409, "TOUR_POINTS_FROM_TRIP"))).toBe(
      "trips:tours.points.saveErrorFromTrip"
    );
    // A station with a night sent as a route correction (tester 2026-09-26).
    expect(tourPointsSaveErrorKey(refused(400, "VIA_POINT_HAS_NIGHT"))).toBe(
      "trips:tours.points.saveErrorViaNight"
    );
    expect(tourPointsSaveErrorKey(refused(400))).toBe("trips:tours.points.saveErrorInvalid");
    expect(tourPointsSaveErrorKey(refused(404))).toBe("trips:tours.points.saveErrorGone");
    expect(tourPointsSaveErrorKey(refused(500))).toBe("trips:tours.points.saveError");
    expect(tourPointsSaveErrorKey(new Error("Network Error"))).toBe(
      "trips:tours.points.saveErrorOffline"
    );
  });
});
