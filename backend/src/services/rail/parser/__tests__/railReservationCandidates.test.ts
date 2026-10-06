import { prisma } from "../../../../db";
import { toRailCandidate } from "../railCandidates";
import type { ParsedRailBooking } from "../types";

/**
 * A reservation document against the database (forgejo#203): its legs look
 * up the user's OWN journeys and nobody else's, and a reservation never comes
 * back as a duplicate check or a new ride. Invented stations and values.
 */
describe("reservation candidates", () => {
  let userId: string;
  let otherId: string;
  let journeyId: string;

  const reservation: ParsedRailBooking = {
    bookingReference: "Q9R8ST",
    travelClass: "second",
    tariff: null,
    price: null,
    currency: null,
    operator: "Deutsche Bahn",
    source: "db-reservation",
    documentKind: "reservation",
    legs: [
      {
        depStationName: "Mittelhausen Testbf",
        arrStationName: "Beispielburg Testbf",
        departureLocal: "2026-03-14T08:40",
        arrivalLocal: "2026-03-14T09:55",
        trainCategory: "ICE",
        trainNumber: "1507",
        coach: "7",
        seat: "45 46",
        direction: "outbound",
      },
      {
        depStationName: "Beispielburg Testbf",
        arrStationName: "Nordhafen Testbf",
        departureLocal: "2026-03-14T10:20",
        arrivalLocal: "2026-03-14T11:30",
        trainCategory: "IC",
        trainNumber: "2217",
        coach: "4",
        seat: "87",
        direction: "outbound",
      },
    ],
  };

  const ride = (owner: string) => ({
    userId: owner,
    trainCategory: "ICE",
    trainNumber: "1507",
    depStationName: "Nordstadt Testbf",
    depLat: 54,
    depLon: 10,
    depTimezone: "Europe/Berlin",
    arrStationName: "Beispielburg Testbf",
    arrLat: 53,
    arrLon: 9,
    arrTimezone: "Europe/Berlin",
    // 07:30 and 09:55 in Berlin in March are 06:30 and 08:55 UTC.
    departureTime: new Date("2026-03-14T06:30:00Z"),
    arrivalTime: new Date("2026-03-14T08:55:00Z"),
  });

  beforeAll(async () => {
    const stamp = Date.now();
    userId = (
      await prisma.user.create({ data: { username: `railres-${stamp}`, passwordHash: "x" } })
    ).id;
    otherId = (
      await prisma.user.create({ data: { username: `railres-other-${stamp}`, passwordHash: "x" } })
    ).id;
    journeyId = (await prisma.railJourney.create({ data: ride(userId) })).id;
    // Someone else's identical ride: never a target of this user's reservation.
    await prisma.railJourney.create({ data: { ...ride(otherId), coach: "1", seat: "1" } });
  });

  afterAll(async () => {
    await prisma.railJourney.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  });

  it("attaches the sub-section to the user's journey and finds none for the other train", async () => {
    const candidate = await toRailCandidate(reservation, userId);
    expect(candidate.documentKind).toBe("reservation");
    expect(candidate.legs.map((l) => l.duplicateOf)).toEqual([null, null]);
    expect(candidate.legs[0].reservation).toMatchObject({
      kind: "attach",
      subSection: true,
      target: {
        id: journeyId,
        departureLocal: "2026-03-14T07:30",
        arrivalLocal: "2026-03-14T09:55",
      },
    });
    expect(candidate.legs[1].reservation).toEqual({ kind: "none", reason: "noJourney" });
  });

  it("matches nothing without a user, and nothing of another user's", async () => {
    const anonymous = await toRailCandidate(reservation, undefined);
    expect(anonymous.legs[0].reservation).toEqual({ kind: "none", reason: "noJourney" });
    const stranger = await toRailCandidate(reservation, "00000000-0000-4000-8000-000000000000");
    expect(stranger.legs[0].reservation).toEqual({ kind: "none", reason: "noJourney" });
  });
});
