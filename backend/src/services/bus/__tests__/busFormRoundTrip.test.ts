import { draftFrom, toBusInput } from "../../../../../frontend/src/components/bus/busFormModel";
import type { BusJourney } from "../../../../../frontend/src/types/bus";
import { mergeBusJourney, type BusJourneyState } from "../busJourneyWrite";
import { updateBusJourneySchema } from "../../../schemas/bus";

// The model imports one constant from a React component (`BusStationField.tsx`),
// and this tree does not transpile JSX. The component is stubbed with that
// constant; the model under test is the real file.
jest.mock("../../../../../frontend/src/components/bus/BusStationField", () => ({
  EMPTY_TERMINAL: { name: "", address: "", lat: null, lon: null, country: null },
}));

// The edit form's contract with the server (forgejo#214, forgejo#215): open a
// stored ride, change something that is not a time, send what the form sends,
// and the stored instants and precisions come back unchanged. Both halves are
// the real ones — the web's model and the server's merge — because each side's
// own tests passed while the pair lost an hour.

const BERLIN = { lat: 52.5069, lon: 13.2778 };

/** A Berlin ride whose departure is the LATER 02:30 of 25 Oct 2026 (CET, 01:30Z). */
function storedState(overrides: Partial<BusJourneyState> = {}): BusJourneyState {
  return {
    depStationName: "ZOB Berlin",
    depAddress: null,
    depLat: BERLIN.lat,
    depLon: BERLIN.lon,
    depCountry: "DE",
    depTimezone: "Europe/Berlin",
    arrStationName: "ZOB Berlin",
    arrAddress: null,
    arrLat: BERLIN.lat,
    arrLon: BERLIN.lon,
    arrCountry: "DE",
    arrTimezone: "Europe/Berlin",
    departureTime: new Date("2026-10-25T01:30:00.000Z"),
    arrivalTime: new Date("2026-10-25T09:00:00.000Z"),
    depPrecision: "minute",
    arrPrecision: "minute",
    distanceKm: null,
    distanceSource: null,
    status: "scheduled",
    ...overrides,
  };
}

/** The wire shape of that row, as the API's `times` object describes it. */
function wireRide(state: BusJourneyState, extra: Partial<BusJourney> = {}): BusJourney {
  return {
    id: "r1",
    userId: "u1",
    operator: null,
    lineName: null,
    rideKind: null,
    depStationName: state.depStationName,
    depAddress: null,
    depLat: state.depLat,
    depLon: state.depLon,
    depCountry: state.depCountry,
    depTimezone: state.depTimezone,
    arrStationName: state.arrStationName,
    arrAddress: null,
    arrLat: state.arrLat,
    arrLon: state.arrLon,
    arrCountry: state.arrCountry,
    arrTimezone: state.arrTimezone,
    departureTime: state.departureTime.toISOString(),
    arrivalTime: state.arrivalTime?.toISOString() ?? null,
    distanceKm: null,
    distanceSource: null,
    geometry: null,
    geometrySource: "straight",
    actualDepartureTime: null,
    actualArrivalTime: null,
    fareClass: null,
    seat: null,
    bookingReference: null,
    price: null,
    currency: "EUR",
    status: "scheduled",
    delayMinutes: null,
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    times: {
      departure: {
        utc: "2026-10-25T01:30:00.000Z",
        zone: "Europe/Berlin",
        offset: "+01:00",
        local: "2026-10-25T02:30:00",
        precision: "minute",
      },
      arrival: {
        utc: "2026-10-25T09:00:00.000Z",
        zone: "Europe/Berlin",
        offset: "+01:00",
        local: "2026-10-25T10:00:00",
        precision: "minute",
      },
      actualDeparture: null,
      actualArrival: null,
    },
    ...extra,
  } as BusJourney;
}

/** What the form would PATCH after the user changed only the notes, run through the route's schema. */
function patchAfterNotesEdit(ride: BusJourney) {
  const draft = { ...draftFrom(ride), notes: "changed" };
  return updateBusJourneySchema.parse(JSON.parse(JSON.stringify(toBusInput(draft))));
}

describe("bus form round trip", () => {
  it("a notes-only edit keeps the later occurrence of a repeated hour (forgejo#214)", () => {
    const existing = storedState();
    const merged = mergeBusJourney(existing, patchAfterNotesEdit(wireRide(existing)));
    expect(merged.departureTime.toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });

  it("the same edit on the EARLIER occurrence keeps that one", () => {
    const existing = storedState({ departureTime: new Date("2026-10-25T00:30:00.000Z") });
    const ride = wireRide(existing, {
      times: {
        ...wireRide(existing).times!,
        departure: {
          utc: "2026-10-25T00:30:00.000Z",
          zone: "Europe/Berlin",
          offset: "+02:00",
          local: "2026-10-25T02:30:00",
          precision: "minute",
        },
      },
    });
    const merged = mergeBusJourney(existing, patchAfterNotesEdit(ride));
    expect(merged.departureTime.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("a minute departure with a day-only arrival keeps its precisions (forgejo#215)", () => {
    const existing = storedState({
      departureTime: new Date("2026-10-24T08:00:00.000Z"),
      arrivalTime: new Date("2026-10-24T22:00:00.000Z"),
      arrPrecision: "day",
    });
    const base = wireRide(existing);
    const ride = wireRide(existing, {
      times: {
        ...base.times!,
        departure: {
          ...base.times!.departure!,
          local: "2026-10-24T10:00:00",
          utc: "2026-10-24T08:00:00.000Z",
          offset: "+02:00",
        },
        arrival: { ...base.times!.arrival!, local: "2026-10-25T00:00:00", precision: "day" },
      },
    });
    const merged = mergeBusJourney(existing, patchAfterNotesEdit(ride));
    expect(merged.depPrecision).toBe("minute");
    expect(merged.arrPrecision).toBe("day");
  });
});
