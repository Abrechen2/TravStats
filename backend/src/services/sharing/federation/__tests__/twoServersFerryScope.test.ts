/**
 * A ferry's `manualScope` travels between servers only to a peer that names the
 * `ferry-manual-scope` feature (rc.46). A peer from before it has strict wire shapes and would
 * refuse the whole message over the unknown key — so it gets the change without it, and the line
 * arrives as that crossing's own, as it did before.
 */
import { offerAndAccept, pairAcross } from "./sharedTripFixtures";
import { servers, user, useTwoServers, type Server } from "./twoServerHarness";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

const DEP = { lat: 54.315, lon: 10.141 };
const ARR = { lat: 59.903, lon: 10.739 };
const LINE = [
  [DEP.lon, DEP.lat],
  [10.6, 57.6],
  [ARR.lon, ARR.lat],
];

async function sharedCrossing() {
  const anna = await user(a, "Anna");
  const ben = await user(b, "Ben");
  const remote = await pairAcross(a, anna, b, ben);
  const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Oslo 2027" } });
  const ferry = await a.prisma.ferryJourney.create({
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
      departureTime: new Date("2027-08-01T12:00:00Z"),
      arrivalTime: new Date("2027-08-02T08:00:00Z"),
    },
  });
  const benTrip = await offerAndAccept(a, anna, trip.id, remote.id, b, ben);
  const benFerry = await b.prisma.ferryJourney.findFirstOrThrow({ where: { tripId: benTrip } });
  return { anna, ferry, benFerry };
}

/** Anna draws a pair line through the write path (snapshot, write, propagate), then it is sent. */
async function drawPairLine(userId: string, ferryId: string) {
  await a.prisma.$transaction(async (tx) => {
    const before = await a.propagate.shareSnapshot(tx, "ferry", ferryId);
    await tx.ferryJourney.update({
      where: { id: ferryId },
      data: { geometry: LINE, geometrySource: "manual", manualScope: "pair" },
    });
    await a.propagate.propagateWrite(tx, userId, "ferry", ferryId, before);
  });
  await a.outbox.runDeliveries();
}

it("a peer that names ferry-manual-scope receives the pair scope with the line", async () => {
  const t = await sharedCrossing();
  await drawPairLine(t.anna, t.ferry.id);
  const copy = await b.prisma.ferryJourney.findUniqueOrThrow({ where: { id: t.benFerry.id } });
  expect(copy.geometrySource).toBe("manual");
  expect(copy.manualScope).toBe("pair");
});

it("a peer from before it gets the line without the scope, and nothing is parked", async () => {
  const t = await sharedCrossing();
  const served = b.peerFeatures.servedFeatures();
  const spy = jest
    .spyOn(b.peerFeatures, "servedFeatures")
    .mockReturnValue(served.filter((f) => f !== "ferry-manual-scope"));
  a.peerFeatures.forgetPeerFeatures();
  try {
    await drawPairLine(t.anna, t.ferry.id);
    const copy = await b.prisma.ferryJourney.findUniqueOrThrow({ where: { id: t.benFerry.id } });
    expect(copy.geometrySource).toBe("manual");
    expect(copy.geometry).toEqual(LINE);
    // Not sent (this harness's B would have stored it): NULL reads as the crossing's own line.
    expect(copy.manualScope).toBeNull();
    expect(await a.prisma.tripShareOutbox.count({ where: { parkedAt: { not: null } } })).toBe(0);
  } finally {
    spy.mockRestore();
    a.peerFeatures.forgetPeerFeatures();
  }
});
