/**
 * Owner ruling 2026-11-05 (ledger `surface-segments-as-flights`): the train and
 * bus segments sold inside a flight booking (Lufthansa Express Rail / Express
 * Bus, AIRail) are rail and bus rides, not flights. Read as flights they landed
 * in flight kilometres, flight CO2 and the passport's airports.
 */

jest.mock("../../parsers/llmAvailability", () => ({
  isLlmAvailable: jest.fn(async () => true),
  recordLlmProbe: jest.fn(),
}));
jest.mock("../../bookingParser", () => ({
  parseBookingText: jest.fn(),
  parseBookingEmail: jest.fn(),
}));

import { parseDocument } from "../parseDocument";
import { parseBookingEmail, type ParsedBooking } from "../../bookingParser";
import { classifySurfaceSegment } from "../../../shared/surfaceSegment";

const flight: ParsedBooking = {
  airline: "Lufthansa",
  flightNumber: "LH400",
  departureCode: "FRA",
  arrivalCode: "JFK",
  departureTime: "2026-12-01T10:00",
  arrivalTime: "2026-12-01T12:30",
  pnr: "ABC123",
  aircraft: "Boeing 747-8",
  missing: [],
};
const train: ParsedBooking = {
  airline: "Lufthansa",
  flightNumber: "LH8878",
  departureCode: "QKL",
  arrivalCode: "FRA",
  departureTime: "2026-12-01T06:12",
  arrivalTime: "2026-12-01T07:20",
  pnr: "ABC123",
  aircraft: "TRN",
  operatingAirline: "Deutsche Bahn",
  missing: [],
};
const bus: ParsedBooking = {
  ...train,
  flightNumber: "LH2447",
  departureCode: "NUE",
  arrivalCode: "MUC",
  aircraft: "BUS",
  operatingAirline: "Munich Airport Express",
};

describe("surface segments inside a flight booking", () => {
  beforeEach(() => {
    (parseBookingEmail as jest.Mock).mockResolvedValue({
      flights: [train, flight, bus],
      parserUsed: "regex",
      ollamaAvailable: false,
    });
  });

  it("turns a TRN and a BUS segment into rail and bus legs and leaves only the flight a flight", async () => {
    const { body } = await parseDocument({
      text: "Lufthansa booking",
      subject: "Your booking",
      domain: "flight",
      source: "email",
    });
    if (body.domain !== "flight") throw new Error("expected a flight body");
    expect(body.flights.map((f) => f.flightNumber)).toEqual(["LH400"]);
    const legs = (body.surfaceBookings ?? []).flatMap((b) => b.legs);
    expect(legs.map((l) => [l.trainNumber, l.transit?.mode])).toEqual([
      ["LH8878", "rail"],
      ["LH2447", "bus"],
    ]);
    expect(body.surfaceBookings?.[0]).toMatchObject({
      bookingReference: "ABC123",
      source: "flight-booking",
    });
  });

  it("answers a booking with no ground segment exactly as before", async () => {
    (parseBookingEmail as jest.Mock).mockResolvedValue({
      flights: [flight],
      parserUsed: "regex",
      ollamaAvailable: false,
    });
    const { body } = await parseDocument({
      text: "Lufthansa booking",
      domain: "flight",
      source: "email",
    });
    expect(body).not.toHaveProperty("surfaceBookings");
    if (body.domain === "flight") expect(body.flights).toHaveLength(1);
  });

  it("keeps a segment with no departure clock a flight instead of inventing a time", async () => {
    (parseBookingEmail as jest.Mock).mockResolvedValue({
      flights: [{ ...train, departureTime: undefined }],
      parserUsed: "regex",
      ollamaAvailable: false,
    });
    const { body } = await parseDocument({ text: "x", domain: "flight", source: "email" });
    if (body.domain !== "flight") throw new Error("expected a flight body");
    expect(body.flights).toHaveLength(1);
    expect(body).not.toHaveProperty("surfaceBookings");
  });
});

describe("classifySurfaceSegment", () => {
  it("reads equipment, operator and nothing else — no carrier is named", () => {
    expect(classifySurfaceSegment({ aircraft: "TRN" })?.mode).toBe("rail");
    expect(classifySurfaceSegment({ aircraft: "BUS" })?.mode).toBe("bus");
    expect(classifySurfaceSegment({ aircraft: "RFS" })?.mode).toBe("bus");
    expect(classifySurfaceSegment({ operatingAirline: "DB" })?.mode).toBe("rail");
    expect(classifySurfaceSegment({ airline: "Lufthansa Express Rail" })?.mode).toBe("rail");
    expect(classifySurfaceSegment({ airline: "Lufthansa Express Bus" })?.mode).toBe("bus");
  });

  it("never mistakes an aircraft for a bus: Airbus is not a bus", () => {
    expect(classifySurfaceSegment({ aircraft: "Airbus A321", airline: "Eurowings" })).toBeNull();
    expect(classifySurfaceSegment({ aircraft: "Boeing 737-800" })).toBeNull();
  });

  it("does not turn a flight into a train on an unknown airport code alone", () => {
    expect(
      classifySurfaceSegment({ departureIsAirport: false, arrivalIsAirport: false })
    ).toBeNull();
  });

  it("lets equipment outrank the operator", () => {
    expect(
      classifySurfaceSegment({ aircraft: "TRN", operatingAirline: "City Bus GmbH" })?.mode
    ).toBe("rail");
  });
});
