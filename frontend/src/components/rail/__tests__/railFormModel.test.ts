import { describe, it, expect } from "vitest";
import {
  saveErrorFrom,
  applyLookup,
  canSubmit,
  connectionDraftFrom,
  draftFrom,
  toRailInput,
} from "../railFormModel";
import { makeRailJourney } from "./railJourneyFixture";
import type { RailJourney, RailLookupAnswer } from "../../../types/rail";

const journey: RailJourney = {
  tightConnection: false,
  id: "j1",
  userId: "u1",
  operator: "DB Fernverkehr",
  trainCategory: "ICE",
  trainNumber: "9557",
  depStationName: "Frankfurt (Main) Hbf",
  depStationCode: null,
  depStationId: null,
  depLat: 50.1071,
  depLon: 8.6632,
  depCountry: "DE",
  depTimezone: "Europe/Berlin",
  arrStationName: "Paris Est",
  arrStationCode: null,
  arrStationId: null,
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

describe("the lookup in the form", () => {
  const match: NonNullable<RailLookupAnswer["match"]> = {
    provider: "transitous",
    ref: "trip-696",
    operator: "DB Fernverkehr AG",
    trainCategory: "ICE",
    trainNumber: "696",
    boardingIndex: 1,
    hasGeometry: true,
    stops: [
      {
        name: "Mainz",
        lat: 50,
        lon: 8.26,
        stationId: 1,
        code: "1",
        country: "DE",
        arrivalLocal: null,
        departureLocal: "2026-09-26T05:40",
      },
      {
        name: "Frankfurt",
        lat: 50.1,
        lon: 8.66,
        stationId: 2,
        code: "2",
        country: "DE",
        arrivalLocal: "2026-09-26T06:10",
        departureLocal: "2026-09-26T06:15",
      },
      {
        name: "Fulda",
        lat: 50.55,
        lon: 9.68,
        stationId: 3,
        code: "3",
        country: "DE",
        arrivalLocal: null,
        departureLocal: "2026-09-26T07:12",
      },
      {
        name: "Berlin",
        lat: 52.55,
        lon: 13.39,
        stationId: null,
        code: null,
        country: null,
        arrivalLocal: "2026-09-26T10:43",
        departureLocal: null,
      },
    ],
  };

  it("boards at the station asked from, alights at the chosen stop, and keeps the match", () => {
    const next = applyLookup({ ...draftFrom(journey), seat: "45" }, match, 3);
    expect(next.departure).toMatchObject({ name: "Frankfurt", stationId: 2, code: "2" });
    expect(next.arrival).toMatchObject({ name: "Berlin", stationId: null, lat: 52.55 });
    expect(next.departureLocal).toBe("2026-09-26T06:15");
    expect(next.arrivalLocal).toBe("2026-09-26T10:43");
    expect(next.lookup).toEqual({ provider: "transitous", ref: "trip-696" });
    // What a timetable cannot know stays the user's.
    expect(next.seat).toBe("45");
    expect(toRailInput(next).lookup).toEqual({ provider: "transitous", ref: "trip-696" });
  });

  it("keeps the user's own time where the timetable gives none", () => {
    const next = applyLookup({ ...draftFrom(journey), arrivalLocal: "2026-09-26T07:20" }, match, 2);
    expect(next.arrivalLocal).toBe("2026-09-26T07:20");
  });

  it("refuses an arrival stop that is not after the boarding one", () => {
    expect(() => applyLookup(draftFrom(journey), match, 0)).toThrow();
    expect(() => applyLookup(draftFrom(journey), match, 1)).toThrow();
  });

  it("reads a saved match back, and sends null when there is none", () => {
    const linked = { ...journey, lookupProvider: "transitous" as const, lookupRef: "trip-696" };
    expect(draftFrom(linked).lookup).toEqual({ provider: "transitous", ref: "trip-696" });
    expect(toRailInput(draftFrom(journey)).lookup).toBeNull();
  });
});

describe("connectionDraftFrom", () => {
  // Frankfurt 06:15 UTC -> Fulda 05:10 UTC is the fixture; Fulda is on Berlin time.
  const previous = makeRailJourney({
    tripId: "trip-1",
    bookingReference: "AB12CD",
    travelClass: "first",
    companions: ["Alex"],
    price: 49.9,
    seat: "45",
  });

  it("leaves from where the previous leg arrived, at its arrival clock", () => {
    const draft = connectionDraftFrom(previous);
    expect(draft.departure).toMatchObject({ name: "Fulda", lat: 50.55, lon: 9.68 });
    expect(draft.departureLocal).toBe("2026-09-26T07:10");
    expect(draft.arrival.name).toBe("");
    expect(draft.arrivalLocal).toBe("");
  });

  it("keeps the trip, class, company and booking reference, not the ticket's own fields", () => {
    const draft = connectionDraftFrom(previous);
    expect(draft).toMatchObject({
      tripId: "trip-1",
      bookingReference: "AB12CD",
      travelClass: "first",
      companions: ["Alex"],
      trainNumber: "",
      price: "",
      seat: "",
      lookup: null,
    });
  });

  it("falls back to the departure clock when the arrival is unknown", () => {
    const draft = connectionDraftFrom({ ...previous, arrivalTime: null });
    expect(draft.departureLocal).toBe("2026-09-26T06:15");
  });
});

describe("saveErrorFrom", () => {
  const refusal = (data: Record<string, unknown>) => ({ response: { data } });

  it("maps each rail refusal code to the form's own sentence and field", () => {
    expect(
      saveErrorFrom(refusal({ code: "RAIL_ARRIVAL_BEFORE_DEPARTURE", field: "arrivalLocal" }))
    ).toEqual({ key: "rail:form.errors.arrivalBeforeDeparture", field: "arrivalLocal" });
    expect(
      saveErrorFrom(refusal({ code: "RAIL_LOCAL_TIME_NONEXISTENT", field: "departureLocal" }))
    ).toEqual({ key: "rail:form.errors.nonexistentTime", field: "departureLocal" });
    expect(
      saveErrorFrom(refusal({ code: "RAIL_INVALID_INPUT", field: "departureStation" }))
    ).toEqual({
      key: "rail:form.errors.invalidField",
      field: null,
      fieldLabelKey: "rail:form.departureStation",
    });
    // Review minor 5: a plain input the server names is the field to show it at.
    expect(saveErrorFrom(refusal({ code: "RAIL_INVALID_INPUT", field: "coach" }))).toEqual({
      key: "rail:form.errors.invalidField",
      field: "coach",
      fieldLabelKey: "rail:form.coach",
    });
  });

  it("falls back to the generic sentence, never to the server's prose", () => {
    expect(saveErrorFrom(refusal({ error: "arrival must not precede departure" }))).toEqual({
      key: "rail:form.saveError",
      field: null,
    });
    expect(saveErrorFrom(refusal({ code: "RAIL_INVALID_INPUT", field: "nonsense" }))).toEqual({
      key: "rail:form.errors.invalid",
      field: null,
    });
    expect(saveErrorFrom(new Error("Network Error")).key).toBe("rail:form.saveError");
  });
  it("reads a refusal that is not a rail field code through the shared save rule", () => {
    expect(saveErrorFrom(refusal({ code: "DUPLICATE" }))).toEqual({
      key: "common:saveErrors.duplicate",
      field: null,
    });
    expect(saveErrorFrom({ isAxiosError: true }).key).toBe("common:saveErrors.network");
  });
});

// forgejo#212: a ride stored by its day alone opened as a midnight clock and
// any save wrote that 00:00 back as a time nobody typed.
describe("a day-only ride", () => {
  const dayRide: RailJourney = {
    ...journey,
    departureTime: "2026-09-20T22:00:00.000Z",
    arrivalTime: null,
    delayMinutes: 5,
    times: {
      departure: {
        utc: "2026-09-20T22:00:00.000Z",
        zone: "Europe/Berlin",
        offset: "+02:00",
        local: "2026-09-21T00:00:00",
        precision: "day",
      },
      arrival: null,
      actualDeparture: null,
      actualArrival: null,
    },
  };

  it("opens on its day, read from the station's clock rather than the UTC instant", () => {
    const draft = draftFrom(dayRide);
    expect(draft.departureDayOnly).toBe(true);
    expect(draft.arrivalDayOnly).toBe(false);
    expect(draft.departureLocal).toBe("2026-09-21");
    expect(draft.arrivalLocal).toBe("");
  });

  it("is saved back as a day, with no arrival and no delay", () => {
    const input = toRailInput(draftFrom(dayRide));
    expect(input.departureLocal).toBe("2026-09-21");
    expect(input.arrivalLocal).toBeNull();
    expect(input.delayMinutes).toBeNull();
  });

  // The server treats an absent arrival as no clock constraint, so a day-only
  // box beside one must not take the delay away.
  it("a day-only box beside an absent arrival does not block the delay", () => {
    const draft = {
      ...draftFrom(journey),
      arrivalLocal: "",
      arrivalDayOnly: true,
      delayMinutes: "12",
    };
    expect(toRailInput(draft).delayMinutes).toBe(12);
    expect(toRailInput({ ...draft, arrivalLocal: "2026-09-20" }).delayMinutes).toBeNull();
    expect(toRailInput({ ...draft, departureDayOnly: true }).delayMinutes).toBeNull();
  });

  it("sends a typed arrival clock as a clock: the day-only flag is per end", () => {
    const input = toRailInput({ ...draftFrom(dayRide), arrivalLocal: "2026-09-22T07:30" });
    expect(input.arrivalLocal).toBe("2026-09-22T07:30");
    expect(input.delayMinutes).toBeNull();
  });

  // The server takes a day or a clock for each end on its own.
  describe("mixed precision", () => {
    const zoned = (local: string, utc: string, precision: "day" | "minute") => ({
      utc,
      zone: "Europe/Berlin",
      offset: "+02:00",
      local,
      precision,
    });
    const dayThenClock: RailJourney = {
      ...dayRide,
      arrivalTime: "2026-09-21T09:20:00.000Z",
      times: {
        departure: zoned("2026-09-21T00:00:00", "2026-09-20T22:00:00.000Z", "day"),
        arrival: zoned("2026-09-21T11:20:00", "2026-09-21T09:20:00.000Z", "minute"),
        actualDeparture: null,
        actualArrival: null,
      },
    };
    const clockThenDay: RailJourney = {
      ...dayRide,
      arrivalTime: "2026-09-21T22:00:00.000Z",
      times: {
        departure: zoned("2026-09-21T08:15:00", "2026-09-21T06:15:00.000Z", "minute"),
        arrival: zoned("2026-09-22T00:00:00", "2026-09-21T22:00:00.000Z", "day"),
        actualDeparture: null,
        actualArrival: null,
      },
    };

    it("keeps the arrival clock of a ride whose departure is a day", () => {
      const draft = draftFrom(dayThenClock);
      expect(draft).toMatchObject({
        departureDayOnly: true,
        arrivalDayOnly: false,
        departureLocal: "2026-09-21",
        arrivalLocal: "2026-09-21T11:20",
      });
      expect(toRailInput(draft)).toMatchObject({
        departureLocal: "2026-09-21",
        arrivalLocal: "2026-09-21T11:20",
        delayMinutes: null,
      });
    });

    it("sends the arrival of a ride whose departure is a clock as the day it is", () => {
      const draft = draftFrom({ ...clockThenDay, delayMinutes: 5 });
      expect(draft).toMatchObject({
        departureDayOnly: false,
        arrivalDayOnly: true,
        departureLocal: "2026-09-21T08:15",
        arrivalLocal: "2026-09-22",
      });
      expect(toRailInput(draft)).toMatchObject({
        departureLocal: "2026-09-21T08:15",
        arrivalLocal: "2026-09-22",
        delayMinutes: null,
      });
    });

    it("starts the next leg with the precision of the arrival it follows", () => {
      const next = connectionDraftFrom(clockThenDay);
      expect(next).toMatchObject({
        departureLocal: "2026-09-22",
        departureDayOnly: true,
        arrivalDayOnly: false,
      });
      expect(connectionDraftFrom(dayThenClock)).toMatchObject({
        departureLocal: "2026-09-21T11:20",
        departureDayOnly: false,
      });
      // No arrival stored: the departure's precision is all there is.
      expect(connectionDraftFrom(dayRide).departureDayOnly).toBe(true);
    });
  });

  it("leaves a minute-precision ride on its clock", () => {
    const draft = draftFrom(journey);
    expect(draft.departureDayOnly).toBe(false);
    expect(draft.arrivalDayOnly).toBe(false);
    expect(toRailInput(draft).departureLocal).toBe("2026-07-01T08:15");
  });

  it("starts a new ride on a clock", () => {
    expect(draftFrom(null)).toMatchObject({ departureDayOnly: false, arrivalDayOnly: false });
  });

  // The leg after a day-only ride has no clock to start from either; a
  // 00:00 invented for it would be the same defect one leg later.
  it("hands its day, not a midnight, to the connection after it", () => {
    const next = connectionDraftFrom(dayRide);
    expect(next.departureDayOnly).toBe(true);
    expect(next.arrivalDayOnly).toBe(false);
    expect(next.departureLocal).toBe("2026-09-21");
    expect(connectionDraftFrom(journey).departureDayOnly).toBe(false);
  });

  it("leaves day-only when a lookup gives the leg its clocks", () => {
    const match: NonNullable<RailLookupAnswer["match"]> = {
      provider: "transitous",
      ref: "trip",
      operator: null,
      trainCategory: "ICE",
      trainNumber: "9557",
      boardingIndex: 0,
      stops: [
        {
          name: "A",
          lat: 50,
          lon: 8,
          country: "DE",
          code: null,
          stationId: null,
          arrivalLocal: null,
          departureLocal: "2026-09-21T08:15",
        },
        {
          name: "B",
          lat: 51,
          lon: 9,
          country: "DE",
          code: null,
          stationId: null,
          arrivalLocal: "2026-09-21T10:00",
          departureLocal: null,
        },
      ],
    } as unknown as NonNullable<RailLookupAnswer["match"]>;
    const next = applyLookup(draftFrom(dayRide), match, 1);
    expect(next.departureDayOnly).toBe(false);
    expect(next.arrivalDayOnly).toBe(false);
    expect(next.departureLocal).toBe("2026-09-21T08:15");
    expect(next.arrivalLocal).toBe("2026-09-21T10:00");
  });

  it("clears the flag only for the end the lookup gives a time for", () => {
    const stop = (departureLocal: string | null, arrivalLocal: string | null) => ({
      name: "X",
      lat: 50,
      lon: 8,
      country: "DE",
      code: null,
      stationId: null,
      arrivalLocal,
      departureLocal,
    });
    const match = {
      provider: "transitous",
      ref: "trip",
      operator: null,
      trainCategory: "ICE",
      trainNumber: "9557",
      boardingIndex: 0,
      stops: [stop("2026-09-21T08:15", null), stop(null, null)],
    } as unknown as NonNullable<RailLookupAnswer["match"]>;
    const both = { ...draftFrom(dayRide), arrivalLocal: "2026-09-22", arrivalDayOnly: true };
    const next = applyLookup(both, match, 1);
    expect(next).toMatchObject({
      departureLocal: "2026-09-21T08:15",
      departureDayOnly: false,
      arrivalLocal: "2026-09-22",
      arrivalDayOnly: true,
    });
  });
});

// forgejo#251: the form kept the station wall clock but not WHICH 02:30 of a
// repeated autumn hour the stored instant was, so any edit moved a "later"
// ride back an hour (the server takes the earlier occurrence by default).
describe("a ride in a repeated hour", () => {
  const repeatedRide = (
    utc: string,
    offset: string,
    local = "2026-10-25T02:30:00"
  ): RailJourney => ({
    ...journey,
    departureTime: utc,
    arrivalTime: null,
    times: {
      departure: { utc, zone: "Europe/Berlin", offset, local, precision: "minute" },
      arrival: null,
      actualDeparture: null,
      actualArrival: null,
    },
  });
  const later = repeatedRide("2026-10-25T01:30:00.000Z", "+01:00");
  const earlier = repeatedRide("2026-10-25T00:30:00.000Z", "+02:00");

  it("remembers the later occurrence and sends it back", () => {
    const draft = draftFrom(later);
    expect(draft.departureLocal).toBe("2026-10-25T02:30");
    expect(draft.departureFold).toBe("later");
    expect(toRailInput(draft)).toMatchObject({
      departureLocal: "2026-10-25T02:30",
      departureFold: "later",
      arrivalFold: null,
    });
  });

  it("remembers the earlier occurrence as such", () => {
    expect(draftFrom(earlier).departureFold).toBe("earlier");
  });

  it("has no fold for a time that is not repeated", () => {
    const draft = draftFrom(journey);
    expect(draft.departureFold).toBeNull();
    expect(draft.arrivalFold).toBeNull();
    expect(toRailInput(draft)).toMatchObject({ departureFold: null, arrivalFold: null });
    expect(draftFrom(null)).toMatchObject({ departureFold: null, arrivalFold: null });
  });

  it("has no fold for an end stored by its day", () => {
    const dayEnd = repeatedRide("2026-10-24T22:00:00.000Z", "+02:00", "2026-10-25T00:00:00");
    expect(draftFrom(dayEnd).departureFold).toBeNull();
  });

  it("starts the next leg on the occurrence of the end whose clock it copies", () => {
    // No arrival stored: the leg before ended where its departure clock says.
    expect(connectionDraftFrom(later)).toMatchObject({ departureFold: "later", arrivalFold: null });
    expect(connectionDraftFrom(earlier).departureFold).toBe("earlier");
    expect(connectionDraftFrom(journey).departureFold).toBeNull();

    const arrivesLater: RailJourney = {
      ...journey,
      arrivalTime: "2026-10-25T01:30:00.000Z",
      times: {
        departure: {
          utc: "2026-10-24T20:00:00.000Z",
          zone: "Europe/Berlin",
          offset: "+02:00",
          local: "2026-10-24T22:00:00",
          precision: "minute",
        },
        arrival: {
          utc: "2026-10-25T01:30:00.000Z",
          zone: "Europe/Berlin",
          offset: "+01:00",
          local: "2026-10-25T02:30:00",
          precision: "minute",
        },
        actualDeparture: null,
        actualArrival: null,
      },
    };
    const next = connectionDraftFrom(arrivesLater);
    expect(next).toMatchObject({
      departureLocal: "2026-10-25T02:30",
      departureFold: "later",
      arrivalFold: null,
    });
    expect(toRailInput({ ...next, ...completeStations(next) })).toMatchObject({
      departureLocal: "2026-10-25T02:30",
      departureFold: "later",
    });
  });
});

/** A connection draft has no arrival station yet; give it one so it can be sent. */
function completeStations(draft: ReturnType<typeof draftFrom>): Partial<typeof draft> {
  return { arrival: { ...draft.departure, name: "Hamburg Hbf", lat: 53.55, lon: 10.0 } };
}

describe("applyLookup and the occurrence of a repeated hour", () => {
  const stop = (
    lat: number,
    lon: number,
    departureLocal: string | null,
    arrivalLocal: string | null
  ) => ({
    name: "X",
    lat,
    lon,
    country: "DE",
    code: null,
    stationId: null,
    arrivalLocal,
    departureLocal,
  });
  const matchOf = (...stops: ReturnType<typeof stop>[]) =>
    ({
      provider: "transitous",
      ref: "trip",
      operator: null,
      trainCategory: "ICE",
      trainNumber: "9557",
      boardingIndex: 0,
      stops,
    }) as unknown as NonNullable<RailLookupAnswer["match"]>;
  const base = draftFrom({
    ...journey,
    departureTime: "2026-10-25T01:30:00.000Z",
    arrivalTime: "2026-10-25T01:40:00.000Z",
    times: {
      departure: {
        utc: "2026-10-25T01:30:00.000Z",
        zone: "Europe/Berlin",
        offset: "+01:00",
        local: "2026-10-25T02:30:00",
        precision: "minute",
      },
      arrival: {
        utc: "2026-10-25T01:40:00.000Z",
        zone: "Europe/Berlin",
        offset: "+01:00",
        local: "2026-10-25T02:40:00",
        precision: "minute",
      },
      actualDeparture: null,
      actualArrival: null,
    },
  });
  const dep = [journey.depLat, journey.depLon] as const;
  const arr = [journey.arrLat, journey.arrLon] as const;

  it("starts from two later occurrences", () => {
    expect(base).toMatchObject({ departureFold: "later", arrivalFold: "later" });
  });

  it("keeps an end's fold while the lookup neither gives it a time nor moves its station", () => {
    const next = applyLookup(base, matchOf(stop(...dep, null, null), stop(...arr, null, null)), 1);
    expect(next).toMatchObject({ departureFold: "later", arrivalFold: "later" });
  });

  it("drops the fold of the end the lookup gives a time for", () => {
    const next = applyLookup(
      base,
      matchOf(stop(...dep, "2026-10-25T08:00", null), stop(...arr, null, null)),
      1
    );
    expect(next).toMatchObject({ departureFold: null, arrivalFold: "later" });
  });

  it("drops the fold of an end whose station the lookup moves, even without a time", () => {
    const next = applyLookup(
      base,
      matchOf(stop(...dep, null, null), stop(52.5, 13.4, null, null)),
      1
    );
    expect(next).toMatchObject({ departureFold: "later", arrivalFold: null });
  });
});
