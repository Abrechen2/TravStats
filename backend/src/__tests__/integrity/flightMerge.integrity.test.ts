/**
 * Auditor I2, data-integrity audit 2026-09-19 — NOT COMMITTED.
 *
 * `POST /flights?merge=true` is the one write path that folds an incoming
 * document into a row the user may have curated by hand. The claim in
 * `utils/flightMerge.ts` is "never overwrites an existing non-empty value —
 * the existing flight wins on every conflict", with ONE stated exception:
 * `rebooking` (matched on the booking reference AND both endpoints) may move
 * the scheduled times and the flight number.
 *
 * This pins the claim from the other side: what happens when the INCOMING
 * source is the empty one. A parsed mail sets every field it did not find to
 * null, so "fill if empty" has to mean "and never write a null over a value".
 */
import { buildFlightMergePatch } from "../../utils/flightMerge";
import type { Flight } from "../../prisma";
import type { CreateFlightInput } from "../../schemas/flight";

const curated = {
  id: "f1",
  seatNumber: "12A",
  seatClass: "business",
  gate: "B24",
  notes: "Upgrade eingelöst",
  price: 412.5,
  currency: "EUR",
  bookingReference: "ABC123",
  ticketNumber: "220-1234567890",
  tags: ["work"],
  coPassengers: ["Anna"],
  companions: ["Anna"],
  flightNumber: "LH123",
  departureTime: new Date("2026-05-01T08:00:00Z"),
  arrivalTime: new Date("2026-05-01T10:00:00Z"),
  actualDeparture: new Date("2026-05-01T08:12:00Z"),
  actualArrival: new Date("2026-05-01T10:05:00Z"),
  enrichmentHistory: null,
} as unknown as Flight;

const sparse = {
  flightNumber: "LH123",
  departure: { iata: "MUC" },
  arrival: { iata: "FRA" },
  seatNumber: null,
  seatClass: null,
  gate: null,
  notes: null,
  price: null,
  currency: null,
  bookingReference: null,
  ticketNumber: null,
  tags: [],
  coPassengers: [],
  companions: [],
} as unknown as CreateFlightInput;

describe("buildFlightMergePatch", () => {
  it("writes NOTHING when the incoming document carries only nulls", () => {
    const { patch, mergedFields } = buildFlightMergePatch(curated, sparse);
    expect(mergedFields).toEqual([]);
    expect(patch).toEqual({});
  });

  it("writes nothing over a curated value even when the incoming value differs", () => {
    const contradicting = {
      ...sparse,
      seatNumber: "3C",
      gate: "A1",
      notes: "etwas anderes",
      price: 99,
      currency: "USD",
      ticketNumber: "999",
      tags: ["holiday"],
      companions: ["Bert"],
    } as unknown as CreateFlightInput;

    const { patch, mergedFields } = buildFlightMergePatch(curated, contradicting);
    expect(mergedFields).toEqual([]);
    expect(patch).toEqual({});
  });

  it("fills only the gaps, and records the merge", () => {
    const withGaps = { ...curated, seatNumber: null, gate: "", notes: "  " } as unknown as Flight;
    const incoming = {
      ...sparse,
      seatNumber: "3C",
      gate: "A1",
      notes: "aus der Mail",
      price: 99,
    } as unknown as CreateFlightInput;

    const { patch, mergedFields } = buildFlightMergePatch(withGaps, incoming);
    expect(mergedFields.sort()).toEqual(["gate", "notes", "seatNumber"]);
    expect(patch.seatNumber).toBe("3C");
    // `price` was already 412.5 and must not move.
    expect(patch.price).toBeUndefined();
    expect(Array.isArray(patch.enrichmentHistory)).toBe(true);
  });

  it("a rebooking moves the scheduled times and the flight number — and NOTHING else", () => {
    const incoming = {
      ...sparse,
      flightNumber: "LH456",
      departureLocal: "2026-05-02T09:00:00",
      depTimezone: "UTC",
      arrivalLocal: "2026-05-02T11:00:00",
      arrTimezone: "UTC",
      seatNumber: "3C",
      notes: "andere Notiz",
      price: 99,
    } as unknown as CreateFlightInput;

    const { patch, mergedFields } = buildFlightMergePatch(curated, incoming, { rebooking: true });

    expect(mergedFields.sort()).toEqual(["arrivalTime", "departureTime", "flightNumber"]);
    expect(patch.seatNumber).toBeUndefined();
    expect(patch.notes).toBeUndefined();
    expect(patch.price).toBeUndefined();
  });

  it("a rebooking that carries NO times leaves the stored times alone", () => {
    const { patch, mergedFields } = buildFlightMergePatch(curated, sparse, { rebooking: true });
    expect(mergedFields).toEqual([]);
    expect(patch.departureTime).toBeUndefined();
    expect(patch.arrivalTime).toBeUndefined();
  });

  it("never moves the ACTUAL times, not even on a rebooking", () => {
    const incoming = {
      ...sparse,
      actualDepartureLocal: "2026-05-02T09:30:00",
      actualDepartureTz: "UTC",
      actualArrivalLocal: "2026-05-02T11:30:00",
      actualArrivalTz: "UTC",
    } as unknown as CreateFlightInput;

    const { patch } = buildFlightMergePatch(curated, incoming, { rebooking: true });
    expect(patch.actualDeparture).toBeUndefined();
    expect(patch.actualArrival).toBeUndefined();
  });
});
