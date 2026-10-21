/**
 * The receiver's lock from the precondition to the write covers what a change lands on, not only
 * the entry's own row (F-S4d review leftover): a cruise's port calls live in `cruise_stops`, a
 * stay's house in `lodgings`. A local save to one of those committed between the check and the
 * write was silently replaced by the incoming value. Over real TLS between the harness's servers.
 */
import { Client } from "pg";
import { peerDatabaseUrl } from "./peerDatabase";
import { servers, user as harnessUser, useTwoServers, B, type Server } from "./twoServerHarness";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

async function shareTrip(fill: (anna: string, tripId: string) => Promise<unknown>) {
  const anna = await harnessUser(a, "Anna");
  const ben = await harnessUser(b, "Ben");
  const { code } = await a.invites.createTripInvite(anna);
  await b.claim.claimTripInvite(ben, code);
  const remote = await a.prisma.remoteShareAccount.findFirstOrThrow({
    where: { userId: anna, origin: B },
  });
  const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Unterwegs" } });
  await fill(anna, trip.id);
  await a.offers.offerTrip(anna, trip.id, remote.id);
  const [offer] = await b.offerInbox.listReceivedOffers(ben);
  const { tripId: benTrip } = await b.offerInbox.acceptOffer(ben, offer.id);
  await a.outbox.runDeliveries();
  return { anna, ben, trip, benTrip };
}

/** While B applies the incoming change, Ben's own save runs on a connection of its own. */
async function raceLocalSave(
  entity: "cruise" | "lodgingStay",
  sql: string,
  params: unknown[]
): Promise<jest.SpyInstance> {
  const adapter = b.adapters.ADAPTERS[entity];
  const apply = adapter.apply.bind(adapter);
  const url = new URL(peerDatabaseUrl());
  url.search = "";
  const own = new Client({ connectionString: url.toString() });
  await own.connect();
  let local: Promise<unknown> = Promise.resolve();
  const spy = jest.spyOn(adapter, "apply").mockImplementationOnce(async (...args) => {
    local = own.query(sql, params);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return apply(...args);
  });
  try {
    await a.outbox.runDeliveries();
    await local;
  } finally {
    await own.end();
  }
  return spy;
}

describe("a local save to a row the change lands on", () => {
  it("a cruise's port call: Ben's own save is not replaced by the incoming one", async () => {
    const at = (h: number) =>
      new Date(`2030-07-0${h < 24 ? 1 : 2}T${String(h % 24).padStart(2, "0")}:00:00.000Z`);
    const { anna, benTrip } = await shareTrip(async (userId, tripId) =>
      a.prisma.cruise.create({
        data: {
          userId,
          tripId,
          cruiseLine: "Teste",
          stops: {
            create: [
              { dayNumber: 1, isAtSea: true, arrivalTime: at(8) },
              { dayNumber: 2, isAtSea: true, arrivalTime: at(32) },
            ],
          },
        },
      })
    );
    const cruise = await a.prisma.cruise.findFirstOrThrow({
      where: { userId: anna },
      include: { stops: { orderBy: { dayNumber: "asc" } } },
    });
    await a.prisma.$transaction(async (tx) => {
      const before = await a.propagate.shareSnapshot(tx, "cruise", cruise.id);
      await tx.cruiseStop.update({
        where: { id: cruise.stops[0].id },
        data: { arrivalTime: at(9) },
      });
      await a.propagate.propagateWrite(tx, anna, "cruise", cruise.id, before);
    });
    const copy = await b.prisma.cruise.findFirstOrThrow({
      where: { tripId: benTrip },
      include: { stops: { orderBy: { dayNumber: "asc" } } },
    });
    const spy = await raceLocalSave(
      "cruise",
      "UPDATE cruise_stops SET arrival_time = $1::timestamp WHERE id = $2",
      [at(10).toISOString(), copy.stops[0].id]
    );
    expect(spy).toHaveBeenCalled();
    const stop = await b.prisma.cruiseStop.findUniqueOrThrow({ where: { id: copy.stops[0].id } });
    expect(stop.arrivalTime?.toISOString()).toBe(at(10).toISOString());
  });

  it("a stay's house: Ben's own save is not replaced by the incoming one", async () => {
    const { anna, benTrip } = await shareTrip(async (userId, tripId) => {
      const lodging = await a.prisma.lodging.create({
        data: { userId, name: "Hotel Avenida", city: "Lisboa", country: "Portugal" },
      });
      return a.prisma.lodgingStay.create({
        data: {
          userId,
          tripId,
          lodgingId: lodging.id,
          checkIn: new Date("2030-06-01T00:00:00.000Z"),
          checkOut: new Date("2030-06-04T00:00:00.000Z"),
        },
      });
    });
    const stay = await a.prisma.lodgingStay.findFirstOrThrow({ where: { userId: anna } });
    await a.prisma.$transaction(async (tx) => {
      const before = await a.propagate.shareSnapshot(tx, "lodgingStay", stay.id);
      await tx.lodging.update({
        where: { id: stay.lodgingId },
        data: { website: "https://avenida.example" },
      });
      await a.propagate.propagateWrite(tx, anna, "lodgingStay", stay.id, before);
    });
    const copy = await b.prisma.lodgingStay.findFirstOrThrow({ where: { tripId: benTrip } });
    const spy = await raceLocalSave(
      "lodgingStay",
      "UPDATE lodgings SET website = $1 WHERE id = $2",
      ["https://ben.example", copy.lodgingId]
    );
    expect(spy).toHaveBeenCalled();
    const house = await b.prisma.lodging.findUniqueOrThrow({ where: { id: copy.lodgingId } });
    expect(house.website).toBe("https://ben.example");
  });
});
