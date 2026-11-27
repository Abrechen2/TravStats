/**
 * A ferry's hand-drawn line carries its scope into a share (rc.46 follow-up):
 * a pair line ("every crossing between these two ports") arrived on the
 * recipient's copy with `manualScope` NULL, which reads as that crossing's own
 * line — so the recipient's pair tools treated it as "only this crossing".
 */
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { setFerryManualRoute } from "../../ferry/ferryManualRoute";
import { shareTripWithUser } from "../shareTrip";

const users: string[] = [];
// Kiel -> Oslo, bent west of the chord.
const DEP = { lat: 54.315, lon: 10.141 };
const ARR = { lat: 59.903, lon: 10.739 };
const LINE: Array<[number, number]> = [
  [DEP.lon, DEP.lat],
  [10.6, 57.6],
  [ARR.lon, ARR.lat],
];

async function user(firstName: string): Promise<string> {
  const u = await prisma.user.create({
    data: { username: `fms-${randomUUID().slice(0, 8)}`, passwordHash: "test-only", firstName },
  });
  users.push(u.id);
  return u.id;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

async function sharedCrossing() {
  const anna = await user("Anna");
  const ben = await user("Ben");
  await prisma.shareConsent.create({
    data: { requesterId: anna, targetId: ben, status: "accepted" },
  });
  const trip = await prisma.trip.create({ data: { userId: anna, name: "Oslo" } });
  const ride = await prisma.ferryJourney.create({
    data: {
      userId: anna,
      tripId: trip.id,
      operator: "Color Line",
      depStationName: "Kiel",
      depLat: DEP.lat,
      depLon: DEP.lon,
      depTimezone: "Europe/Berlin",
      arrStationName: "Oslo",
      arrLat: ARR.lat,
      arrLon: ARR.lon,
      arrTimezone: "Europe/Oslo",
      departureTime: new Date("2026-08-01T12:00:00Z"),
      arrivalTime: new Date("2026-08-02T08:00:00Z"),
    },
  });
  return { anna, ben, trip, ride };
}

const copyOf = (ben: string, groupId: string) =>
  prisma.ferryJourney.findFirstOrThrow({ where: { userId: ben, trip: { shareGroupId: groupId } } });

it("a pair line drawn before the share arrives as a pair line", async () => {
  const t = await sharedCrossing();
  await setFerryManualRoute(t.anna, t.ride.id, { waypoints: LINE, scope: "pair" });
  const { groupId } = await shareTripWithUser(t.anna, t.trip.id, t.ben);
  const copy = await copyOf(t.ben, groupId);
  expect(copy.geometrySource).toBe("manual");
  expect(copy.manualScope).toBe("pair");
});

it("a pair line drawn after the share reaches the copy as pair-scoped, a 'this crossing only' line as journey", async () => {
  const t = await sharedCrossing();
  const { groupId } = await shareTripWithUser(t.anna, t.trip.id, t.ben);
  await setFerryManualRoute(t.anna, t.ride.id, { waypoints: LINE, scope: "pair" });
  expect((await copyOf(t.ben, groupId)).manualScope).toBe("pair");
  await setFerryManualRoute(t.anna, t.ride.id, { waypoints: LINE, scope: "journey" });
  expect((await copyOf(t.ben, groupId)).manualScope).toBe("journey");
});
