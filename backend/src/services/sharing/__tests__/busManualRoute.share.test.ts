/**
 * A bus ride's hand-drawn line (GitHub #409) travels with a share the way the ferry's does:
 * the line lives in `geometry` with `geometrySource = manual`, both fact columns, so the copy
 * receives the drawn line, a redraw and a "keep straight" choice.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { setBusManualRoute } from "../../bus/busManualRoute";
import { shareTripWithUser } from "../shareTrip";

const users: string[] = [];
// Berlin ZOB -> Hamburg ZOB, with a detour via Schwerin.
const DEP = { lat: 52.507, lon: 13.279 };
const ARR = { lat: 53.552, lon: 10.011 };
const LINE: Array<[number, number]> = [
  [DEP.lon, DEP.lat],
  [11.415, 53.635],
  [ARR.lon, ARR.lat],
];
const REDRAWN: Array<[number, number]> = [
  [DEP.lon, DEP.lat],
  [12.1, 53.1],
  [ARR.lon, ARR.lat],
];

async function user(firstName: string): Promise<string> {
  const u = await prisma.user.create({
    data: { username: `bms-${randomUUID().slice(0, 8)}`, passwordHash: "test-only", firstName },
  });
  users.push(u.id);
  return u.id;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

async function sharedRide() {
  const anna = await user("Anna");
  const ben = await user("Ben");
  await prisma.shareConsent.create({
    data: { requesterId: anna, targetId: ben, status: "accepted" },
  });
  const trip = await prisma.trip.create({ data: { userId: anna, name: "Hamburg" } });
  const ride = await prisma.busJourney.create({
    data: {
      userId: anna,
      tripId: trip.id,
      operator: "FlixBus",
      depStationName: "Berlin ZOB",
      depLat: DEP.lat,
      depLon: DEP.lon,
      depTimezone: "Europe/Berlin",
      arrStationName: "Hamburg ZOB",
      arrLat: ARR.lat,
      arrLon: ARR.lon,
      arrTimezone: "Europe/Berlin",
      departureTime: new Date("2026-08-01T07:00:00Z"),
      arrivalTime: new Date("2026-08-01T10:00:00Z"),
    },
  });
  const { groupId } = await shareTripWithUser(anna, trip.id, ben);
  const copy = () =>
    prisma.busJourney.findFirstOrThrow({
      where: { userId: ben, trip: { shareGroupId: groupId } },
    });
  return { anna, ben, ride, copy };
}

it("a bus ride's hand-drawn line reaches the shared copy, and so does a redraw", async () => {
  const t = await sharedRide();
  await setBusManualRoute(t.anna, t.ride.id, { waypoints: LINE });
  let copy = await t.copy();
  expect(copy.geometry).toEqual(LINE);
  expect(copy.geometrySource).toBe("manual");
  expect(copy.distanceSource).toBe("route");

  await setBusManualRoute(t.anna, t.ride.id, { waypoints: REDRAWN });
  copy = await t.copy();
  expect(copy.geometry).toEqual(REDRAWN);
});

it("a 'keep straight' choice reaches the copy as manual with no line", async () => {
  const t = await sharedRide();
  await setBusManualRoute(t.anna, t.ride.id, { waypoints: LINE });
  await setBusManualRoute(t.anna, t.ride.id, { keepStraight: true });
  const copy = await t.copy();
  expect(copy.geometry).toBeNull();
  expect(copy.geometrySource).toBe("manual");
  expect(copy.distanceSource).toBe("great_circle");
});

it("a ride shared after its line was drawn starts with that line", async () => {
  const anna = await user("Anna");
  const ben = await user("Ben");
  await prisma.shareConsent.create({
    data: { requesterId: anna, targetId: ben, status: "accepted" },
  });
  const trip = await prisma.trip.create({ data: { userId: anna, name: "Hamburg" } });
  const ride = await prisma.busJourney.create({
    data: {
      userId: anna,
      tripId: trip.id,
      depStationName: "Berlin ZOB",
      depLat: DEP.lat,
      depLon: DEP.lon,
      arrStationName: "Hamburg ZOB",
      arrLat: ARR.lat,
      arrLon: ARR.lon,
      departureTime: new Date("2026-08-01T07:00:00Z"),
    },
  });
  await setBusManualRoute(anna, ride.id, { waypoints: LINE });
  const { groupId } = await shareTripWithUser(anna, trip.id, ben);
  const copy = await prisma.busJourney.findFirstOrThrow({
    where: { userId: ben, trip: { shareGroupId: groupId } },
  });
  expect(copy.geometry).toEqual(LINE);
  expect(copy.geometrySource).toBe("manual");
});
