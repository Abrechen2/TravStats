/**
 * Sharing UAT 2 and its security review (2026-11-28): a shared cruise brings the code-less ports
 * the receiver lacks (the owner's own Yangtze ports), but ONLY when the receiver accepts or links —
 * reading, comparing or declining an offer never writes the global port catalogue.
 */
import { randomUUID } from "crypto";

import { offerAndAccept, pairAcross } from "./sharedTripFixtures";
import { servers, user, useTwoServers, type Server } from "./twoServerHarness";

useTwoServers();

let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

const names: string[] = [];
afterAll(async () => {
  for (const s of [a, b]) {
    await s.prisma.cruise.deleteMany({ where: { routeName: { startsWith: "Carried " } } });
    await s.prisma.port.deleteMany({ where: { name: { in: names } } });
  }
});

/** Anna's cruise on A between two of her own ports (no UN/LOCODE), with a drawn line. */
async function annasCruise(anna: string, tag: string) {
  const port = (n: string, lat: number) => {
    names.push(`Carried ${n} ${tag}`);
    return a.prisma.port.create({
      data: {
        name: `Carried ${n} ${tag}`,
        unlocode: null,
        lat,
        lon: 107.7,
        country: "China",
        isUserAdded: true,
      },
    });
  };
  const from = await port("Fengdu", 29.88);
  const to = await port("Wushan", 31.07);
  const trip = await a.prisma.trip.create({ data: { userId: anna, name: `Jangtse ${tag}` } });
  const cruise = await a.prisma.cruise.create({
    data: {
      userId: anna,
      tripId: trip.id,
      routeName: `Carried ${tag}`,
      departurePortId: from.id,
      arrivalPortId: to.id,
      startDate: new Date("2024-05-15T00:00:00.000Z"),
      endDate: new Date("2024-05-17T00:00:00.000Z"),
      stops: {
        create: [
          { dayNumber: 1, portId: from.id, position: 0 },
          { dayNumber: 3, portId: to.id, position: 1 },
        ],
      },
      legs: {
        create: [
          {
            ordinal: 0,
            fromPortId: from.id,
            toPortId: to.id,
            distanceKm: 150,
            method: "manual_polyline",
            routerVersion: "t",
            confidence: "high",
          },
        ],
      },
    },
  });
  await a.prisma.cruiseLegRoute.create({
    data: {
      cruiseId: cruise.id,
      fromKind: "port",
      fromRef: String(from.id),
      toKind: "port",
      toRef: String(to.id),
      waypoints: [
        [107.7, 29.88],
        [107.9, 30.5],
        [107.7, 31.07],
      ],
    },
  });
  return { trip, from, to };
}

const portsNamed = (tag: string) =>
  b.prisma.port.findMany({ where: { name: { contains: tag } }, orderBy: { id: "asc" } });

async function setup() {
  const anna = await user(a, "Anna");
  const ben = await user(b, "Ben");
  const remote = await pairAcross(a, anna, b, ben);
  return { anna, ben, remote };
}

it("a dry run names the ports linking would add and writes none", async () => {
  const { anna, ben, remote } = await setup();
  const tag = randomUUID().slice(0, 6);
  const { trip } = await annasCruise(anna, tag);
  const own = await b.prisma.trip.create({ data: { userId: ben, name: `Jangtse ${tag}` } });
  await a.offers.offerTrip(anna, trip.id, remote.id);
  const [offer] = (await b.offerInbox.listReceivedOffers(ben)).filter(
    (o) => o.trip.name === `Jangtse ${tag}`
  );
  const preview = await b.offerLink.previewOfferLink(ben, offer.id, own.id);
  expect(preview.access === "full" && preview.newPorts?.sort()).toEqual(
    [`Carried Fengdu ${tag}`, `Carried Wushan ${tag}`].sort()
  );
  expect(await portsNamed(tag)).toEqual([]);

  await b.offerInbox.declineOffer(ben, offer.id);
  expect(await portsNamed(tag)).toEqual([]);
});

it("accepting adds each port once, records the server, and reuses a port within 1 km", async () => {
  const { anna, ben, remote } = await setup();
  const tag = randomUUID().slice(0, 6);
  // Ben's server already holds Wushan as a user port 0.4 km off: reused, not doubled.
  names.push(`Carried Wushan ${tag}`);
  const wushan = await b.prisma.port.create({
    data: {
      name: `Carried Wushan ${tag}`,
      unlocode: null,
      lat: 31.0736,
      lon: 107.7,
      country: "China",
      isUserAdded: true,
    },
  });
  const { trip } = await annasCruise(anna, tag);
  const copy = await offerAndAccept(a, anna, trip.id, remote.id, b, ben);

  const ports = await portsNamed(tag);
  expect(ports.map((p) => [p.name, p.isUserAdded, p.carriedFrom])).toEqual([
    [`Carried Wushan ${tag}`, true, null],
    [`Carried Fengdu ${tag}`, true, a.origin],
  ]);
  const cruise = await b.prisma.cruise.findFirstOrThrow({
    where: { tripId: copy },
    include: { stops: { orderBy: { position: "asc" } }, legs: true },
  });
  expect(cruise.stops.map((s) => s.portId)).toEqual([ports[1].id, wushan.id]);
  expect(cruise.legs).toHaveLength(1);
});
