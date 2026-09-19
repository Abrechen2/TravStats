import type { Flight } from "../prisma";

import { createFlightSchema } from "../schemas/flight";
import { buildFlightMergePatch } from "../utils/flightMerge";

/**
 * Tests for the merge-into-existing-flight branch of POST /flights
 * (issue #84 follow-up). The rule is: re-importing the same flight
 * never overwrites curated values on the existing row, but DOES fill
 * fields the existing row left blank — typical case is a manual entry
 * that gets enriched by a later boarding-pass scan with seat/gate/PNR.
 */

const validIncomingBase = {
  departure: { iata: "FRA", lat: 50.0379, lon: 8.5622 },
  arrival: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
  departureLocal: "2026-05-01T08:00",
  depTimezone: "Europe/Berlin",
  arrivalLocal: "2026-05-01T17:00",
  arrTimezone: "America/New_York",
  flightNumber: "LH123",
};

function makeExistingFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: "existing-id",
    userId: "user-1",
    airline: null,
    operatingAirline: null,
    flightNumber: "LH123",
    callsign: null,
    aircraft: null,
    depIcao: null,
    depIata: "FRA",
    depName: null,
    depLat: 50.0379,
    depLon: 8.5622,
    arrIcao: null,
    arrIata: "JFK",
    arrName: null,
    arrLat: 40.6413,
    arrLon: -73.7781,
    // 08:00 Europe/Berlin → 06:00 UTC (May, CEST)
    departureTime: new Date("2026-05-01T06:00:00.000Z"),
    arrivalTime: new Date("2026-05-01T21:00:00.000Z"),
    status: "scheduled",
    notes: null,
    seatNumber: null,
    seatClass: null,
    boardingGroup: null,
    gate: null,
    terminal: null,
    bookingReference: null,
    ticketNumber: null,
    price: null,
    currency: null,
    taxes: null,
    fees: null,
    category: null,
    tags: [],
    companions: [],
    receiptUrl: null,
    ticketPrice: null,
    createdAt: new Date(),
    actualRoute: null,
    overflownCountries: [],
    routeDistance: null,
    routeSource: null,
    hasLiveTracking: false,
    dataSource: "manual",
    lastModifiedBy: "user",
    enrichmentHistory: null,
    actualDeparture: null,
    actualArrival: null,
    delayMinutes: null,
    co2Kg: null,
    baggageAllowance: null,
    frequentFlyerNumber: null,
    bookingClassLetter: null,
    coPassengers: [],
    parserTemplate: null,
    parserConfidence: null,
    nextApiCheckAt: null,
    tripId: null,
    bookingId: null,
    ...overrides,
  };
}

describe("buildFlightMergePatch", () => {
  it("fills nullish string fields from the incoming payload", () => {
    const existing = makeExistingFlight();
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      seatNumber: "12A",
      gate: "B42",
      terminal: "1",
      bookingReference: "ABC123",
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming);

    expect(patch).toMatchObject({
      seatNumber: "12A",
      gate: "B42",
      terminal: "1",
      bookingReference: "ABC123",
    });
    expect(mergedFields).toEqual(
      expect.arrayContaining(["seatNumber", "gate", "terminal", "bookingReference"])
    );
  });

  it("never overwrites a non-empty existing string field", () => {
    const existing = makeExistingFlight({ seatNumber: "1A", gate: "A1" });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      seatNumber: "12C",
      gate: "B42",
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming);

    expect(patch).not.toHaveProperty("seatNumber");
    expect(patch).not.toHaveProperty("gate");
    expect(mergedFields).not.toContain("seatNumber");
    expect(mergedFields).not.toContain("gate");
  });

  it("treats empty/whitespace-only existing strings as missing", () => {
    const existing = makeExistingFlight({ airline: "", aircraft: "   " });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      airline: "Lufthansa",
      aircraft: "A350-900",
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming);

    expect(patch.airline).toBe("Lufthansa");
    expect(patch.aircraft).toBe("A350-900");
    expect(mergedFields).toEqual(expect.arrayContaining(["airline", "aircraft"]));
  });

  it("fills null number fields but never overwrites", () => {
    const existing = makeExistingFlight({ price: 250, taxes: null });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      price: 999,
      taxes: 42,
      fees: 7,
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming);

    expect(patch).not.toHaveProperty("price");
    expect(patch.taxes).toBe(42);
    expect(patch.fees).toBe(7);
    expect(mergedFields).toEqual(expect.arrayContaining(["taxes", "fees"]));
    expect(mergedFields).not.toContain("price");
  });

  it("fills null date fields and converts (local + tz) pair to Date", () => {
    const existing = makeExistingFlight({ actualDeparture: null });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      actualDepartureLocal: "2026-05-01T08:15",
      actualDepartureTz: "Europe/Berlin",
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming);

    expect(patch.actualDeparture).toBeInstanceOf(Date);
    // 08:15 Europe/Berlin in May (CEST = +02:00) → 06:15 UTC
    expect((patch.actualDeparture as Date).toISOString()).toBe("2026-05-01T06:15:00.000Z");
    expect(mergedFields).toContain("actualDeparture");
  });

  it("recomputes delayMinutes when actualDeparture is filled", () => {
    const existing = makeExistingFlight({ actualDeparture: null });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      // 17 min late vs scheduled 08:00 Europe/Berlin
      actualDepartureLocal: "2026-05-01T08:17",
      actualDepartureTz: "Europe/Berlin",
    });

    const { patch } = buildFlightMergePatch(existing, incoming);

    expect(patch.delayMinutes).toBe(17);
  });

  it("does not recompute delayMinutes if actualDeparture is preserved", () => {
    const existing = makeExistingFlight({
      actualDeparture: new Date("2026-05-01T06:05:00.000Z"),
      delayMinutes: 5,
    });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      actualDepartureLocal: "2026-05-01T09:00", // would be 60 min, but ignored
      actualDepartureTz: "Europe/Berlin",
    });

    const { patch } = buildFlightMergePatch(existing, incoming);

    expect(patch).not.toHaveProperty("delayMinutes");
    expect(patch).not.toHaveProperty("actualDeparture");
  });

  it("fills empty arrays from incoming non-empty arrays", () => {
    const existing = makeExistingFlight({ tags: [], companions: [], coPassengers: [] });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      tags: ["business"],
      companions: ["Alice"],
      coPassengers: ["Bob Smith"],
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming);

    expect(patch.tags).toEqual(["business"]);
    expect(patch.companions).toEqual(["Alice"]);
    expect(patch.coPassengers).toEqual(["Bob Smith"]);
    expect(mergedFields).toEqual(expect.arrayContaining(["tags", "companions", "coPassengers"]));
  });

  it("never overwrites a non-empty existing array", () => {
    const existing = makeExistingFlight({
      tags: ["vacation"],
      companions: ["Charlie"],
    });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      tags: ["business"],
      companions: ["Alice"],
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming);

    expect(patch).not.toHaveProperty("tags");
    expect(patch).not.toHaveProperty("companions");
    expect(mergedFields).not.toContain("tags");
    expect(mergedFields).not.toContain("companions");
  });

  it("appends an enrichmentHistory entry when fields got merged", () => {
    const existing = makeExistingFlight({ enrichmentHistory: null });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      seatNumber: "12A",
      gate: "B42",
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming);

    expect(mergedFields).toEqual(expect.arrayContaining(["seatNumber", "gate"]));
    expect(Array.isArray(patch.enrichmentHistory)).toBe(true);
    const history = patch.enrichmentHistory as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      type: "merge",
      fields: expect.arrayContaining(["seatNumber", "gate"]),
    });
    expect(typeof history[0].timestamp).toBe("string");
  });

  it("preserves existing enrichmentHistory entries on merge", () => {
    const prior = [
      { type: "historical_enrichment", timestamp: "2026-01-01T00:00:00.000Z", confidence: 90 },
    ];
    const existing = makeExistingFlight({
      enrichmentHistory: prior as unknown as Flight["enrichmentHistory"],
    });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      gate: "B42",
    });

    const { patch } = buildFlightMergePatch(existing, incoming);
    const history = patch.enrichmentHistory as Array<Record<string, unknown>>;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ type: "historical_enrichment", confidence: 90 });
    expect(history[1]).toMatchObject({ type: "merge" });
  });

  it("does not touch enrichmentHistory when nothing got merged", () => {
    const existing = makeExistingFlight({
      seatNumber: "1A",
      gate: "A1",
      enrichmentHistory: null,
    });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      seatNumber: "12A",
      gate: "B42",
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming);
    expect(mergedFields).toEqual([]);
    expect(patch).not.toHaveProperty("enrichmentHistory");
  });

  it("returns empty patch and empty mergedFields when nothing to merge", () => {
    const existing = makeExistingFlight({
      airline: "Lufthansa",
      aircraft: "A320",
      seatNumber: "12A",
      gate: "B1",
      terminal: "1",
      tags: ["business"],
    });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      airline: "Lufthansa",
      aircraft: "A320",
      seatNumber: "12A",
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming);

    expect(mergedFields).toEqual([]);
    expect(Object.keys(patch)).toEqual([]);
  });
});

/**
 * forgejo#119. A booking reference is the booking's own identity, so a match
 * on it plus the route means the two rows are the SAME flight — including
 * when the airline moved it. A resent confirmation then carries the new date
 * and sometimes a new flight number, and those have to land: leaving the old
 * ones in place shows the user a flight they are not taking, with nothing to
 * say it moved. Everything else stays fill-if-empty, so curated values are
 * still safe.
 *
 * The route is what keeps this from collapsing a connection. One PNR covers
 * every leg of a through ticket, so FRA-JFK and JFK-LAX share it; only the
 * endpoints tell a moved flight apart from the next leg. That check lives in
 * the caller — this file only pins what the patch does once the caller has
 * decided the two are one booking.
 */
describe("buildFlightMergePatch — a rebooking of the same booking", () => {
  it("moves the departure and arrival times", () => {
    const existing = makeExistingFlight();
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      departureLocal: "2026-05-02T08:00",
      arrivalLocal: "2026-05-02T17:00",
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming, {
      rebooking: true,
    });

    expect(patch.departureTime).toEqual(new Date("2026-05-02T06:00:00.000Z"));
    expect(mergedFields).toEqual(expect.arrayContaining(["departureTime", "arrivalTime"]));
  });

  it("moves the flight number", () => {
    const existing = makeExistingFlight({ flightNumber: "LH123" });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      flightNumber: "LH456",
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming, {
      rebooking: true,
    });

    expect(patch.flightNumber).toBe("LH456");
    expect(mergedFields).toContain("flightNumber");
  });

  it("still refuses to overwrite a curated value that is not the booking", () => {
    const existing = makeExistingFlight({ seatNumber: "1A", notes: "window, over the wing" });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      departureLocal: "2026-05-02T08:00",
      arrivalLocal: "2026-05-02T17:00",
      seatNumber: "12C",
      notes: "something else",
    });

    const { patch } = buildFlightMergePatch(existing, incoming, { rebooking: true });

    expect(patch).not.toHaveProperty("seatNumber");
    expect(patch).not.toHaveProperty("notes");
  });

  it("reports nothing when the resent confirmation is unchanged", () => {
    const existing = makeExistingFlight();
    const incoming = createFlightSchema.parse({ ...validIncomingBase });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming, {
      rebooking: true,
    });

    expect(mergedFields).toEqual([]);
    expect(Object.keys(patch)).toEqual([]);
  });

  it("leaves the times alone without the rebooking flag, which is the old rule", () => {
    const existing = makeExistingFlight();
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      departureLocal: "2026-05-02T08:00",
      arrivalLocal: "2026-05-02T17:00",
      flightNumber: "LH456",
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming);

    expect(patch).not.toHaveProperty("departureTime");
    expect(patch).not.toHaveProperty("flightNumber");
    expect(mergedFields).toEqual([]);
  });

  it("recomputes the delay when the scheduled departure moves under a recorded actual", () => {
    const existing = makeExistingFlight({
      actualDeparture: new Date("2026-05-02T06:30:00.000Z"),
      delayMinutes: 1470,
    });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      departureLocal: "2026-05-02T08:00",
      arrivalLocal: "2026-05-02T17:00",
    });

    const { patch } = buildFlightMergePatch(existing, incoming, { rebooking: true });

    expect(patch.delayMinutes).toBe(30);
  });
});
