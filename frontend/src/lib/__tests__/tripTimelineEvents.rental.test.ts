import { describe, expect, it } from "vitest";
import { buildTimelineEvents } from "../tripTimelineEvents";
import type { Trip } from "../../types";

/**
 * A rental on a trip's timeline (rental spec §6): its pickup and its return,
 * each on its own station's clock — never the reader's. Invented values.
 */
describe("trip timeline — rentals", () => {
  const trip = {
    id: "t1",
    name: "Test",
    rentalBookings: [
      {
        id: "r1",
        provider: "Testcar",
        pickupStationName: "Los Angeles",
        returnStationName: "New York",
        pickupTime: "2026-07-01T17:00:00.000Z",
        returnTime: "2026-07-08T22:00:00.000Z",
        pickupTimezone: "America/Los_Angeles",
        returnTimezone: "America/New_York",
        pickupPrecision: "minute",
        returnPrecision: "minute",
        status: "scheduled",
      },
    ],
  } as unknown as Trip;

  it("adds the pickup and the return, each on its station's clock", () => {
    const events = buildTimelineEvents(trip, []);
    const pickup = events.find((e) => e.kind === "rental-pickup");
    const ret = events.find((e) => e.kind === "rental-return");
    expect(pickup?.when.local.slice(0, 16)).toBe("2026-07-01T10:00");
    expect(ret?.when.local.slice(0, 16)).toBe("2026-07-08T18:00");
  });

  it("keeps a day-precision end a day, without an invented hour", () => {
    const dayTrip = {
      ...trip,
      rentalBookings: [{ ...trip.rentalBookings![0], pickupPrecision: "day" }],
    } as unknown as Trip;
    const pickup = buildTimelineEvents(dayTrip, []).find((e) => e.kind === "rental-pickup");
    expect(pickup?.when.precision).toBe("day");
  });
});
