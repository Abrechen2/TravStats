import { prisma } from "../../../../db";
import { foldStationName } from "../../railStations";
import { toRailCandidate } from "../railCandidates";
import { findBusDuplicate, findDuplicate, type DuplicateStation } from "../railDuplicates";
import type { ParsedRailBooking, ParsedRailLeg } from "../types";

/**
 * A repeat import of a bahn.de connection — which carries no booking
 * reference — must find the rides the first import saved (Codex, pre-RC
 * review of rc.24..main). The first import stores the CATALOGUE's name of a
 * stop it resolved, not the name bahn.de prints, so a lookup by the printed
 * name alone missed every resolved stop and offered the ride again. And two
 * buses leaving one stop in the same minute are two rides unless their
 * destination and line say otherwise. Invented names and EVA numbers (99…).
 */
const PREFIX = `test-raildedupe-${Date.now()}-`;
const EVA = "9922001";

const leg = (over: Partial<ParsedRailLeg> = {}): ParsedRailLeg => ({
  depStationName: "Dedupstadt Hbf (tief)",
  arrStationName: "Dedupdorf",
  departureLocal: "2026-05-02T10:00",
  arrivalLocal: "2026-05-02T10:20",
  trainCategory: "S",
  trainNumber: "1",
  coach: null,
  seat: null,
  direction: null,
  departureStop: { eva: EVA, position: { lat: 48.1002, lon: 11.5002 } },
  arrivalStop: { eva: null, position: { lat: 48.2, lon: 11.6 } },
  ...over,
});

const connection = (legs: ParsedRailLeg[]): ParsedRailBooking => ({
  bookingReference: null,
  travelClass: null,
  tariff: null,
  price: null,
  currency: null,
  operator: null,
  source: "db-share-link",
  legs,
});

const BUS = { mode: "bus" as const, busKind: "city" as const };

describe("repeat import of a connection without a booking reference", () => {
  let userId: string;
  let stationId: number;

  beforeAll(async () => {
    stationId = (
      await prisma.railStation.create({
        data: {
          sourceId: `${PREFIX}0`,
          name: "Dedupstadt Hauptbahnhof",
          searchName: foldStationName("Dedupstadt Hauptbahnhof"),
          uic: EVA,
          dbId: EVA,
          lat: 48.1,
          lon: 11.5,
          country: "DE",
          timezone: "Europe/Berlin",
        },
      })
    ).id;
    userId = (
      await prisma.user.create({
        data: { username: `raildedupe-${Date.now()}`, passwordHash: "x" },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.busJourney.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.railStation.deleteMany({ where: { sourceId: { startsWith: PREFIX } } });
  });

  const savedTrain = (over: {
    depStationName: string;
    depStationId: number | null;
    arrStationName?: string;
    trainCategory?: string | null;
    trainNumber?: string | null;
    bookingReference?: string | null;
    departureTime?: Date;
  }) =>
    prisma.railJourney.create({
      data: {
        userId,
        arrStationName: "Dedupdorf",
        trainCategory: "S",
        trainNumber: "1",
        // 10:00 in Munich in May is 08:00 UTC.
        departureTime: new Date("2026-05-02T08:00:00Z"),
        ...over,
        depLat: 48.1,
        depLon: 11.5,
        depTimezone: "Europe/Berlin",
        arrLat: 48.2,
        arrLon: 11.6,
        arrTimezone: "Europe/Berlin",
      },
    });

  const verdicts = (c: Awaited<ReturnType<typeof toRailCandidate>>) =>
    c.legs.map((l) => [l.duplicateOf, l.possibleDuplicateOf]);

  it("takes a train for this leg only when its number and destination match too", async () => {
    await savedTrain({ depStationName: "Dedupstadt Hauptbahnhof", depStationId: stationId });
    const candidate = await toRailCandidate(
      connection([
        // Another train out of the same station in the same minute.
        leg({ trainNumber: "2" }),
        // The same number, but to somewhere else.
        leg({
          arrStationName: "Anderswo",
          arrivalStop: { eva: null, position: { lat: 48.3, lon: 11.7 } },
        }),
      ]),
      userId
    );
    expect(verdicts(candidate)).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("only flags, never omits, a train whose number one side does not name", async () => {
    const saved = await savedTrain({
      depStationName: "Dedupstadt Hauptbahnhof",
      depStationId: stationId,
      trainNumber: null,
    });
    const candidate = await toRailCandidate(connection([leg()]), userId);
    expect(verdicts(candidate)).toEqual([[null, saved.id]]);
  });

  it("finds a ride saved from a connection when a ticket with a reference comes later", async () => {
    const saved = await savedTrain({
      depStationName: "Dedupstadt Hauptbahnhof",
      depStationId: stationId,
      bookingReference: null,
    });
    const candidate = await toRailCandidate(
      { ...connection([leg()]), bookingReference: "DEDUP42" },
      userId
    );
    expect(verdicts(candidate)).toEqual([[saved.id, null]]);
  });

  it("finds the ride however many others the user has around that day", async () => {
    // Earlier the same day at the same station: older rows than the one sought.
    for (let i = 0; i < 25; i++) {
      await savedTrain({
        depStationName: "Dedupstadt Hauptbahnhof",
        depStationId: stationId,
        departureTime: new Date(Date.UTC(2026, 4, 2, 0, i)),
      });
      await savedBus({
        arrStationName: "Dedupdorf",
        lineName: "Bus 100",
        departureTime: new Date(Date.UTC(2026, 4, 2, 0, i)),
      });
    }
    const train = await savedTrain({
      depStationName: "Dedupstadt Hauptbahnhof",
      depStationId: stationId,
    });
    const bus = await savedBus({ arrStationName: "Dedupdorf", lineName: "Bus 100" });
    const candidate = await toRailCandidate(connection([leg(), busLeg()]), userId);
    expect(verdicts(candidate)).toEqual([
      [train.id, null],
      [bus.id, null],
    ]);
  });

  it("finds a train saved under the catalogue's name of the stop bahn.de printed otherwise", async () => {
    const saved = await savedTrain({
      depStationName: "Dedupstadt Hauptbahnhof",
      depStationId: stationId,
    });
    const candidate = await toRailCandidate(connection([leg()]), userId);
    expect(candidate.legs[0].departureStation).toMatchObject({
      name: "Dedupstadt Hauptbahnhof",
      printedName: "Dedupstadt Hbf (tief)",
    });
    expect(candidate.legs[0].duplicateOf).toBe(saved.id);
  });

  it("finds it by the station itself when the stored name is neither spelling", async () => {
    const saved = await savedTrain({ depStationName: "Dedupstadt Hbf", depStationId: stationId });
    const candidate = await toRailCandidate(connection([leg()]), userId);
    expect(candidate.legs[0].duplicateOf).toBe(saved.id);
  });

  it("still finds a ride saved under the printed name", async () => {
    const saved = await savedTrain({ depStationName: "Dedupstadt Hbf (tief)", depStationId: null });
    const candidate = await toRailCandidate(connection([leg()]), userId);
    // The stop resolved by its EVA number, so the lookup ran on the catalogue
    // row — and the printed name still had to be among the names it tried.
    expect(candidate.legs[0].departureStation).toMatchObject({
      name: "Dedupstadt Hauptbahnhof",
      stationId,
      resolved: true,
    });
    expect(candidate.legs[0].duplicateOf).toBe(saved.id);
  });

  /** A stop as a resolver that dropped the printed spelling hands it over. */
  const catalogueOnly = (name: string): DuplicateStation => ({
    name,
    printedName: name,
    stationId: null,
    code: null,
  });

  it("looks for the leg's own printed names, whatever the resolved stop carries", async () => {
    const train = await savedTrain({ depStationName: "Dedupstadt Hbf (tief)", depStationId: null });
    expect(
      await findDuplicate(
        userId,
        leg(),
        null,
        catalogueOnly("Dedupstadt Hauptbahnhof"),
        catalogueOnly("Dedupdorf Mitte")
      )
    ).toEqual({ duplicateOf: train.id, possibleDuplicateOf: null });

    const bus = await prisma.busJourney.create({
      data: {
        userId,
        depStationName: "Dedupstadt Hbf (tief)",
        depLat: 48.1,
        depLon: 11.5,
        depTimezone: "Europe/Berlin",
        arrStationName: "Dedupdorf",
        arrLat: 48.2,
        arrLon: 11.6,
        departureTime: new Date("2026-05-02T08:00:00Z"),
        lineName: "Bus 100",
      },
    });
    expect(
      await findBusDuplicate(
        userId,
        leg({ trainCategory: "Bus", trainNumber: "100", transit: BUS }),
        catalogueOnly("Dedupstadt Hauptbahnhof"),
        catalogueOnly("Dedupdorf Mitte")
      )
    ).toEqual({ duplicateOf: bus.id, possibleDuplicateOf: null });
  });

  const savedBus = (over: {
    arrStationName: string;
    lineName: string | null;
    departureTime?: Date;
  }) =>
    prisma.busJourney.create({
      data: {
        userId,
        depStationName: "Dedupstadt Hauptbahnhof",
        depLat: 48.1,
        depLon: 11.5,
        depTimezone: "Europe/Berlin",
        arrLat: 48.2,
        arrLon: 11.6,
        departureTime: new Date("2026-05-02T08:00:00Z"),
        ...over,
      },
    });

  const busLeg = (over: Partial<ParsedRailLeg> = {}) =>
    leg({ trainCategory: "Bus", trainNumber: "100", transit: BUS, ...over });

  it("finds a bus ride saved under the catalogue's name, to the same stop on the same line", async () => {
    const saved = await savedBus({ arrStationName: "Dedupdorf", lineName: "Bus 100" });
    const candidate = await toRailCandidate(connection([busLeg()]), userId);
    expect(candidate.legs[0]).toMatchObject({ duplicateOf: saved.id, possibleDuplicateOf: null });
  });

  it("keeps a bus to another destination, or on another line, a ride of its own", async () => {
    await savedBus({ arrStationName: "Dedupdorf", lineName: "Bus 100" });
    const candidate = await toRailCandidate(
      connection([
        busLeg({
          arrStationName: "Anderswo",
          arrivalStop: { eva: null, position: { lat: 48.3, lon: 11.7 } },
        }),
        busLeg({ trainNumber: "54" }),
      ]),
      userId
    );
    expect(candidate.legs.map((l) => [l.duplicateOf, l.possibleDuplicateOf])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("never takes a bare category for a line: two unnumbered buses are only possibly one", async () => {
    const saved = await savedBus({ arrStationName: "Dedupdorf", lineName: "Bus" });
    const candidate = await toRailCandidate(
      connection([busLeg({ trainNumber: null }), busLeg()]),
      userId
    );
    expect(candidate.legs.map((l) => [l.duplicateOf, l.possibleDuplicateOf])).toEqual([
      [null, saved.id],
      [null, saved.id],
    ]);
  });

  it("only flags, never omits, a bus whose line one side does not name", async () => {
    const saved = await savedBus({ arrStationName: "Dedupdorf", lineName: null });
    const candidate = await toRailCandidate(connection([busLeg()]), userId);
    expect(candidate.legs[0]).toMatchObject({ duplicateOf: null, possibleDuplicateOf: saved.id });
  });
});
