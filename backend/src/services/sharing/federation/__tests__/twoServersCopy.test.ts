/**
 * A trip crosses two servers (spec 2026-10-20 phase F-S4c), end to end over real TLS between the
 * two in-process servers of `twoServerHarness.ts`: Anna on A offers a trip with a flight, a stay,
 * a rail ride and a cruise with port calls to Ben on B; nothing lands until Ben accepts; then it
 * is Ben's own trip on B — resolved against B's catalogue, with A's instants and zones, B's
 * statuses, and not one private field.
 */
import { randomUUID } from "crypto";
import {
  B,
  servers,
  setSwitch,
  user as harnessUser,
  useTwoServers,
  type Server,
} from "./twoServerHarness";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

const tag = randomUUID().slice(0, 6).toUpperCase();
const code = (n: string) => `Z${n}${tag.slice(0, 3)}`;
/** Catalogue rows this suite made, per server, removed again in `afterAll`. */
const made = new Map<
  Server,
  { ports: number[]; ships: number[]; stations: number[]; chains: number[] }
>();

async function catalogue(s: Server, withUnmatched: boolean) {
  const port = (name: string, unlocode: string, lat: number, extra: object = {}) =>
    s.prisma.port.create({ data: { name, unlocode, lat, lon: -9, country: "PT", ...extra } });
  const p1 = await port("Port One", code("P1"), 38.7);
  const p4 = await port("Port Four", code("P4"), 37.0);
  const p2 = withUnmatched ? await port("Port Two", code("P2"), 36.0) : null;
  // A's own addition: on A it carries a code B's catalogue has for a real port, but a row a
  // user added travels as name and position only, so B must not match it.
  const p3 = withUnmatched
    ? await port("User Port", code("P3"), 35.0, { isUserAdded: true })
    : await port("Catalogue Port Three", code("P3"), 35.0);
  const ship = await s.prisma.ship.create({
    data: {
      name: "MS Teste",
      imo: `9${tag.replace(/\D/g, "7").padEnd(6, "1").slice(0, 6)}`,
      cruiseLine: "Teste Line",
    },
  });
  const station = await s.prisma.railStation.create({
    data: {
      sourceId: `tst-${tag}`,
      name: "Lisboa Oriente",
      searchName: "lisboa oriente",
      lat: 38.77,
      lon: -9.1,
      country: "PT",
    },
  });
  const chain = await s.prisma.lodgingChain.create({ data: { name: `Teste Hotels ${tag}` } });
  made.set(s, {
    ports: [p1.id, p4.id, p3.id, ...(p2 ? [p2.id] : [])],
    ships: [ship.id],
    stations: [station.id],
    chains: [chain.id],
  });
  return { p1, p2, p3, p4, ship, station, chain };
}

const people = new Map<Server, string[]>();
async function user(s: Server, firstName: string): Promise<string> {
  const id = await harnessUser(s, firstName);
  people.set(s, [...(people.get(s) ?? []), id]);
  return id;
}

const PRIVATE = [
  "12A",
  "secret-note",
  "ROOM-404",
  "CABIN-8123",
  "SEAT-33",
  "EXCURSION-NOTE",
  "PNR-XYZ",
];

async function annasTrip(anna: string, cat: Awaited<ReturnType<typeof catalogue>>) {
  const trip = await a.prisma.trip.create({
    data: {
      userId: anna,
      name: "Portugal 2030",
      startDay: new Date("2030-06-01"),
      endDay: new Date("2030-06-10"),
    },
  });
  await a.prisma.flight.create({
    data: {
      userId: anna,
      tripId: trip.id,
      flightNumber: "TP571",
      depIata: "FRA",
      depIcao: "EDDF",
      arrIata: "LIS",
      arrIcao: "LPPT",
      depLat: 50.03,
      depLon: 8.57,
      arrLat: 38.77,
      arrLon: -9.13,
      departureTime: new Date("2030-06-01T08:00:00.000Z"),
      arrivalTime: new Date("2030-06-01T10:45:00.000Z"),
      depTimezone: "Europe/Berlin",
      arrTimezone: "Europe/Lisbon",
      // A's word, not to be trusted: the flight is years away.
      status: "flown",
      seatNumber: "12A",
      notes: "secret-note",
      bookingReference: "PNR-XYZ",
      price: 321,
    },
  });
  const house = await a.prisma.lodging.create({
    data: {
      userId: anna,
      name: "Hotel Teste",
      city: "Lisboa",
      country: "Portugal",
      lat: 38.71,
      lon: -9.14,
      chainId: cat.chain.id,
    },
  });
  await a.prisma.lodgingStay.create({
    data: {
      userId: anna,
      tripId: trip.id,
      lodgingId: house.id,
      checkIn: new Date("2030-06-01T00:00:00.000Z"),
      checkOut: new Date("2030-06-04T00:00:00.000Z"),
      checkInDate: new Date("2030-06-01"),
      checkOutDate: new Date("2030-06-04"),
      checkInAt: new Date("2030-06-01T14:00:00.000Z"),
      checkOutAt: new Date("2030-06-04T10:00:00.000Z"),
      stayZone: "Europe/Lisbon",
      nights: 3,
      roomNumber: "ROOM-404",
      totalPrice: 500,
      notes: "secret-note",
    },
  });
  await a.prisma.railJourney.create({
    data: {
      userId: anna,
      tripId: trip.id,
      depStationName: "Lisboa Oriente",
      depStationId: cat.station.id,
      depLat: 38.77,
      depLon: -9.1,
      depTimezone: "Europe/Lisbon",
      arrStationName: "Porto Campanhã",
      arrLat: 41.15,
      arrLon: -8.59,
      arrTimezone: "Europe/Lisbon",
      departureTime: new Date("2030-06-04T09:00:00.000Z"),
      arrivalTime: new Date("2030-06-04T12:00:00.000Z"),
      seat: "SEAT-33",
      notes: "secret-note",
    },
  });
  const stop = (dayNumber: number, portId: number | null, extra: object = {}) => ({
    dayNumber,
    portId,
    isAtSea: portId === null,
    stopDate: new Date(`2030-06-0${4 + dayNumber}`),
    stopZone: portId === null ? null : "Europe/Lisbon",
    ...extra,
  });
  await a.prisma.cruise.create({
    data: {
      userId: anna,
      tripId: trip.id,
      shipId: cat.ship.id,
      departurePortId: cat.p1.id,
      arrivalPortId: cat.p2!.id,
      startDay: new Date("2030-06-05"),
      endDay: new Date("2030-06-09"),
      startDate: new Date("2030-06-05T16:00:00.000Z"),
      endDate: new Date("2030-06-09T08:00:00.000Z"),
      startZone: "Europe/Lisbon",
      endZone: "Europe/Lisbon",
      cabinNumber: "CABIN-8123",
      notes: "secret-note",
      stops: {
        create: [
          stop(1, cat.p1.id, { excursionNote: "EXCURSION-NOTE" }),
          stop(2, null),
          stop(3, cat.p4.id),
          stop(4, cat.p2!.id),
          stop(5, cat.p3.id),
        ],
      },
      legs: {
        create: [
          {
            ordinal: 1,
            fromPortId: cat.p1.id,
            toPortId: cat.p4.id,
            distanceKm: 200,
            method: "marnet",
            routerVersion: "t",
          },
          {
            ordinal: 2,
            fromPortId: cat.p4.id,
            toPortId: cat.p2!.id,
            distanceKm: 120,
            method: "marnet",
            routerVersion: "t",
          },
        ],
      },
    },
  });
  return trip;
}

async function pair(anna: string, ben: string) {
  const { code: invite } = await a.invites.createTripInvite(anna);
  await b.claim.claimTripInvite(ben, invite);
  return a.prisma.remoteShareAccount.findFirstOrThrow({ where: { userId: anna, origin: B } });
}

describe("a trip offered across two servers", () => {
  // Inside the describe, so these run before the harness's own teardown disconnects.
  let catA: Awaited<ReturnType<typeof catalogue>>;
  let catB: Awaited<ReturnType<typeof catalogue>>;

  beforeAll(async () => {
    catA = await catalogue(a, true);
    catB = await catalogue(b, false);
  });

  afterAll(async () => {
    for (const s of [a, b]) {
      // Cruises hold their legs' ports (Restrict): the suite's users go first.
      await s.prisma.cruise.deleteMany({
        where: { ship: { id: { in: made.get(s)?.ships ?? [] } } },
      });
      await s.prisma.cruiseLeg.deleteMany({
        where: { fromPortId: { in: made.get(s)?.ports ?? [] } },
      });
      await s.prisma.cruiseLeg.deleteMany({
        where: { toPortId: { in: made.get(s)?.ports ?? [] } },
      });
      const m = made.get(s);
      if (!m) continue;
      await s.prisma.lodging.deleteMany({ where: { chainId: { in: m.chains } } });
      await s.prisma.port.deleteMany({ where: { id: { in: m.ports } } });
      await s.prisma.ship.deleteMany({ where: { id: { in: m.ships } } });
      await s.prisma.railStation.deleteMany({ where: { id: { in: m.stations } } });
      await s.prisma.lodgingChain.deleteMany({ where: { id: { in: m.chains } } });
    }
  });

  it("lands on B only after Ben accepts, as his own trip with A's times and B's catalogue, and no private field", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    const remote = await pair(anna, ben);
    const trip = await annasTrip(anna, catA);
    const received = jest.spyOn(b.entries, "serveEntries");

    const member = await a.offers.offerTrip(anna, trip.id, remote.id);
    expect(member).toMatchObject({ state: "invited", displayName: "Ben", origin: B });

    // Offered, unanswered: nothing in Ben's account.
    const [offer] = await b.offerInbox.listReceivedOffers(ben);
    expect(offer).toMatchObject({
      trip: { name: "Portugal 2030", startDay: "2030-06-01" },
      counts: { flights: 1, lodgingStays: 1, railJourneys: 1, cruises: 1 },
    });
    expect(await b.prisma.trip.count({ where: { userId: ben } })).toBe(0);

    const { tripId } = await b.offerInbox.acceptOffer(ben, offer.id);
    await a.entries.settleDeliveries();

    const copy = await b.prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      include: {
        flights: true,
        lodgingStays: { include: { lodging: true } },
        railJourneys: true,
        cruises: { include: { stops: { orderBy: { dayNumber: "asc" } }, legs: true } },
      },
    });
    expect(copy.userId).toBe(ben);
    expect(copy.name).toBe("Portugal 2030");

    const [flight] = copy.flights;
    expect(flight.departureTime?.toISOString()).toBe("2030-06-01T08:00:00.000Z");
    expect(flight.depTimezone).toBe("Europe/Berlin");
    expect(flight.arrTimezone).toBe("Europe/Lisbon");
    expect(flight.status).toBe("scheduled");
    expect(flight).toMatchObject({
      seatNumber: null,
      notes: null,
      bookingReference: null,
      price: null,
    });

    const [stay] = copy.lodgingStays;
    expect(stay.checkInDate?.toISOString().slice(0, 10)).toBe("2030-06-01");
    expect(stay.checkInAt?.toISOString()).toBe("2030-06-01T14:00:00.000Z");
    expect(stay.stayZone).toBe("Europe/Lisbon");
    expect(stay).toMatchObject({ roomNumber: null, totalPrice: null, notes: null });
    expect(stay.lodging).toMatchObject({
      userId: ben,
      name: "Hotel Teste",
      chainId: catB.chain.id,
    });

    const [rail] = copy.railJourneys;
    expect(rail.depStationId).toBe(catB.station.id);
    expect(rail.arrStationId).toBeNull();
    expect(rail.arrStationName).toBe("Porto Campanhã");
    expect(rail).toMatchObject({ seat: null, notes: null });

    const [cruise] = copy.cruises;
    expect(cruise).toMatchObject({
      shipId: catB.ship.id,
      departurePortId: catB.p1.id,
      arrivalPortId: null,
    });
    expect(cruise).toMatchObject({ cabinNumber: null, notes: null });
    expect(cruise.startDay?.toISOString().slice(0, 10)).toBe("2030-06-05");
    expect(
      cruise.stops.map((s) => [s.dayNumber, s.portId, s.isAtSea, s.unresolvedPortName])
    ).toEqual([
      [1, catB.p1.id, false, null],
      [2, null, true, null],
      [3, catB.p4.id, false, null],
      [4, null, false, "Port Two"],
      [5, null, false, "User Port"],
    ]);
    expect(cruise.stops.every((s) => s.excursionNote === null)).toBe(true);
    // The leg into a port B lacks cannot be described there; the other one is B's own row.
    expect(cruise.legs.map((l) => [l.fromPortId, l.toPortId])).toEqual([[catB.p1.id, catB.p4.id]]);

    const wire = JSON.stringify(received.mock.calls);
    expect(received).toHaveBeenCalled();
    for (const secret of PRIVATE) expect(wire).not.toContain(secret);

    // A sees Ben as an active member of the trip.
    const onA = await a.tripRemoteSharing.tripRemoteSharing(anna, trip.id);
    expect(onA.members).toEqual([expect.objectContaining({ state: "active", stateReason: null })]);
    const onB = await b.tripRemoteSharing.tripRemoteSharing(ben, tripId);
    expect(onB).toMatchObject({
      homeOrigin: a.origin,
      members: [{ displayName: "Anna", state: "active" }],
    });

    // Sending everything again changes nothing on B: a held key is skipped.
    const count = async () =>
      (await b.prisma.flight.count({ where: { userId: ben } })) +
      (await b.prisma.cruise.count({ where: { userId: ben } })) +
      (await b.prisma.cruiseStop.count({ where: { cruise: { userId: ben } } }));
    const before = await count();
    await a.entries.deliverEntries(onA.members[0].id);
    expect(await count()).toBe(before);
  });

  it("copies nothing when Ben declines, and A reads the answer", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    const remote = await pair(anna, ben);
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Nein danke" } });
    await a.offers.offerTrip(anna, trip.id, remote.id);
    const [offer] = await b.offerInbox.listReceivedOffers(ben);
    await b.offerInbox.declineOffer(ben, offer.id);
    await a.entries.settleDeliveries();
    expect(await b.prisma.trip.count({ where: { userId: ben } })).toBe(0);
    expect(await b.offerInbox.listReceivedOffers(ben)).toEqual([]);
    const onA = await a.tripRemoteSharing.tripRemoteSharing(anna, trip.id);
    expect(onA.members).toEqual([expect.objectContaining({ state: "declined" })]);
  });

  it("refuses the offer as off there when B has switched it off, and keeps no member on A", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    const remote = await pair(anna, ben);
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Aus" } });
    await setSwitch(b, false);
    await expect(a.offers.offerTrip(anna, trip.id, remote.id)).rejects.toMatchObject({
      code: "SHARE_REMOTE_PEER_DISABLED",
      extra: { origin: B },
    });
    const after = await a.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(after.shareGroupId).toBeNull();
    expect(await a.prisma.tripShareRemoteMember.count({ where: { remoteId: remote.id } })).toBe(0);
  });

  it("a trip page's invitation brings its offer with the claim, waiting for Cleo's answer", async () => {
    const anna = await user(a, "Anna");
    const cleo = await user(b, "Cleo");
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Per Code" } });
    const { code: invite, tripId } = await a.invites.createTripInvite(anna, trip.id);
    expect(tripId).toBe(trip.id);
    await b.claim.claimTripInvite(cleo, invite);
    const offers = await b.offerInbox.listReceivedOffers(cleo);
    expect(offers).toEqual([
      expect.objectContaining({ trip: expect.objectContaining({ name: "Per Code" }) }),
    ]);
    expect(offers[0].from).toMatchObject({ displayName: "Anna", origin: a.origin });
    expect(await b.prisma.trip.count({ where: { userId: cleo } })).toBe(0);
    const { tripId: cleosTrip } = await b.offerInbox.acceptOffer(cleo, offers[0].id);
    await a.entries.settleDeliveries();
    expect((await b.prisma.trip.findUniqueOrThrow({ where: { id: cleosTrip } })).name).toBe(
      "Per Code"
    );
  });
});
