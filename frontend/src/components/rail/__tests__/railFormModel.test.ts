import { describe, it, expect } from "vitest";
import { canSubmit, draftFrom, toRailInput } from "../railFormModel";
import type { RailJourney } from "../../../types/rail";

const journey: RailJourney = {
  id: "j1",
  userId: "u1",
  operator: "DB Fernverkehr",
  trainCategory: "ICE",
  trainNumber: "9557",
  depStationName: "Frankfurt (Main) Hbf",
  depStationCode: null,
  depLat: 50.1071,
  depLon: 8.6632,
  depCountry: "DE",
  depTimezone: "Europe/Berlin",
  arrStationName: "Paris Est",
  arrStationCode: null,
  arrLat: 48.8768,
  arrLon: 2.3591,
  arrCountry: "FR",
  arrTimezone: "Europe/Paris",
  departureTime: "2026-07-01T06:15:00.000Z",
  arrivalTime: "2026-07-01T10:09:00.000Z",
  distanceKm: 478.2,
  distanceSource: "great_circle",
  geometry: null,
  geometrySource: "straight",
  actualDepartureTime: null,
  actualArrivalTime: null,
  lookupProvider: null,
  lookupRef: null,
  travelClass: "second",
  coach: "7",
  seat: "45",
  bookingReference: "ABC123",
  price: 59.9,
  currency: "EUR",
  status: "completed",
  delayMinutes: null,
  notes: null,
  tags: ["work", "tgv"],
  companions: ["Anna"],
  tripId: null,
  bookingId: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

describe("railFormModel", () => {
  it("opens an existing journey on the stations' own clocks", () => {
    const draft = draftFrom(journey);
    expect(draft.departureLocal).toBe("2026-07-01T08:15");
    expect(draft.arrivalLocal).toBe("2026-07-01T12:09");
  });

  it("does not show a measured distance as if the user had typed it", () => {
    expect(draftFrom(journey).distanceKm).toBe("");
    expect(draftFrom({ ...journey, distanceSource: "user", distanceKm: 573 }).distanceKm).toBe(
      "573"
    );
  });

  it("round-trips an unedited journey into the same write body", () => {
    const input = toRailInput(draftFrom(journey));
    expect(input).toMatchObject({
      operator: "DB Fernverkehr",
      trainCategory: "ICE",
      departureStation: { name: "Frankfurt (Main) Hbf", lat: 50.1071, lon: 8.6632, country: "DE" },
      departureLocal: "2026-07-01T08:15",
      arrivalLocal: "2026-07-01T12:09",
      distanceKm: null,
      travelClass: "second",
      tags: ["work", "tgv"],
      companions: ["Anna"],
      status: "scheduled",
    });
  });

  it("sends an emptied field as null, so an edit can clear it", () => {
    const draft = { ...draftFrom(journey), coach: "  ", bookingReference: "", price: "" };
    const input = toRailInput(draft);
    expect(input.coach).toBeNull();
    expect(input.bookingReference).toBeNull();
    expect(input.price).toBeNull();
  });

  it("states a cancellation and nothing else about the status", () => {
    expect(toRailInput({ ...draftFrom(journey), cancelled: true }).status).toBe("cancelled");
  });

  it("reads a decimal comma in a typed distance", () => {
    expect(toRailInput({ ...draftFrom(journey), distanceKm: "572,5" }).distanceKm).toBe(572.5);
  });

  it("refuses to submit without both positioned stations and a departure", () => {
    const empty = draftFrom(null);
    expect(canSubmit(empty)).toBe(false);
    const filled = draftFrom(journey);
    expect(canSubmit(filled)).toBe(true);
    expect(canSubmit({ ...filled, departureLocal: "" })).toBe(false);
    expect(canSubmit({ ...filled, arrival: { ...filled.arrival, lat: null } })).toBe(false);
    expect(canSubmit({ ...filled, departure: { ...filled.departure, name: " " } })).toBe(false);
  });
});
