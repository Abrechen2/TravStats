import {
  matchReservation,
  withoutSharedTargets,
  type JourneyForMatch,
  type ReservationLeg,
} from "../reservationMatch";

/**
 * The truth table of forgejo#203: a reservation attaches to exactly one
 * logged journey, says so when it finds none or several, and offers a
 * different seat as a change — never a silent overwrite. Invented values.
 */

function journey(over: Partial<JourneyForMatch> = {}): JourneyForMatch {
  return {
    id: "j-1",
    trainCategory: "ICE",
    trainNumber: "1507",
    depStationName: "Nordstadt Hbf",
    arrStationName: "Beispielburg Hbf",
    depStationId: 10,
    arrStationId: 30,
    departureLocal: "2026-03-14T07:30",
    arrivalLocal: "2026-03-14T09:55",
    coach: null,
    seat: null,
    ...over,
  };
}

function leg(over: Partial<ReservationLeg> = {}): ReservationLeg {
  return {
    trainCategory: "ICE",
    trainNumber: "1507",
    departureLocal: "2026-03-14T07:30",
    arrivalLocal: "2026-03-14T09:55",
    coach: "7",
    seat: "45",
    departure: { stationId: 10, names: ["Nordstadt Hbf"] },
    arrival: { stationId: 30, names: ["Beispielburg Hbf"] },
    ...over,
  };
}

describe("matchReservation", () => {
  it("attaches to the one journey of the same train, day and stations", () => {
    expect(matchReservation(leg(), [journey()])).toMatchObject({
      kind: "attach",
      subSection: false,
      target: { id: "j-1" },
    });
  });

  it("finds no journey on another day, another train, or none at all", () => {
    const none = { kind: "none", reason: "noJourney" };
    expect(matchReservation(leg(), [])).toEqual(none);
    expect(matchReservation(leg({ departureLocal: "2026-03-15T07:30" }), [journey()])).toEqual(
      none
    );
    expect(matchReservation(leg({ trainNumber: "1509" }), [journey()])).toEqual(none);
    expect(matchReservation(leg({ trainCategory: "IC" }), [journey()])).toEqual(none);
  });

  it("names every journey when several fit, and picks none of them", () => {
    const result = matchReservation(leg(), [journey(), journey({ id: "j-2" })]);
    expect(result).toEqual({
      kind: "several",
      targets: [expect.objectContaining({ id: "j-1" }), expect.objectContaining({ id: "j-2" })],
    });
  });

  it("attaches a SUB-SECTION that starts and ends inside the journey's span", () => {
    const sub = leg({
      departure: { stationId: 20, names: ["Mittelhausen"] },
      departureLocal: "2026-03-14T08:40",
    });
    expect(matchReservation(sub, [journey()])).toMatchObject({
      kind: "attach",
      subSection: true,
    });
    const middle = leg({
      departure: { stationId: 20, names: ["Mittelhausen"] },
      arrival: { stationId: 25, names: ["Zwischenau"] },
      departureLocal: "2026-03-14T08:40",
      arrivalLocal: "2026-03-14T09:20",
    });
    expect(matchReservation(middle, [journey()])).toMatchObject({ subSection: true });
  });

  it("refuses a stretch that cannot be proved inside the journey", () => {
    const outside = leg({
      departure: { stationId: 20, names: ["Mittelhausen"] },
      departureLocal: "2026-03-14T07:00",
    });
    expect(matchReservation(outside, [journey()])).toMatchObject({ reason: "noJourney" });
    // An end whose time is unknown is not proved inside.
    const unknownEnd = leg({
      arrival: { stationId: 25, names: ["Zwischenau"] },
      arrivalLocal: null,
    });
    expect(matchReservation(unknownEnd, [journey()])).toMatchObject({ reason: "noJourney" });
    // The other direction is not the same ride.
    const reversed = leg({
      departure: { stationId: 30, names: ["Beispielburg Hbf"] },
      arrival: { stationId: 10, names: ["Nordstadt Hbf"] },
    });
    expect(matchReservation(reversed, [journey()])).toMatchObject({ reason: "noJourney" });
  });

  it("offers a different seat as a change and never as an attach", () => {
    const result = matchReservation(leg(), [journey({ coach: "7", seat: "61" })]);
    expect(result).toMatchObject({ kind: "change", target: { coach: "7", seat: "61" } });
  });

  it("fills an empty seat beside a matching coach, and knows a seat already there", () => {
    expect(matchReservation(leg(), [journey({ coach: "7" })])).toMatchObject({ kind: "attach" });
    expect(matchReservation(leg(), [journey({ coach: "7", seat: "45" })])).toMatchObject({
      kind: "alreadySet",
    });
  });

  it("matches on names when either side has no catalogue id, and a number without category", () => {
    const named = leg({
      trainCategory: null,
      departure: { stationId: null, names: ["Nordstadt Hbf"] },
      arrival: { stationId: null, names: ["Beispielburg Hbf"] },
    });
    expect(matchReservation(named, [journey({ depStationId: null })])).toMatchObject({
      kind: "attach",
    });
  });

  it("says why when the reservation itself names no train or no seat", () => {
    expect(matchReservation(leg({ trainNumber: null }), [journey()])).toEqual({
      kind: "none",
      reason: "noTrain",
    });
    expect(matchReservation(leg({ coach: null, seat: null }), [journey()])).toEqual({
      kind: "none",
      reason: "noSeat",
    });
  });
});

describe("withoutSharedTargets", () => {
  it("turns two sections landing on one journey into a question, and leaves the rest", () => {
    const a = matchReservation(leg(), [journey()]);
    const b = matchReservation(leg({ seat: "46" }), [journey()]);
    const c = matchReservation(leg({ trainNumber: null }), [journey()]);
    expect(withoutSharedTargets([a, b, c]).map((m) => m.kind)).toEqual([
      "sameJourneyTwice",
      "sameJourneyTwice",
      "none",
    ]);
  });
});
