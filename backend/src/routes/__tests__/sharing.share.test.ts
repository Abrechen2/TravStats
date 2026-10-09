import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import {
  linkWithConsent,
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * Trip sharing S1 — the copy (design 2026-10-09, decisions 1, 2 and 5): the
 * recipient gets a complete trip of their own, facts only, joined by a group
 * and per-entry keys; sharing twice adds nothing; leaving keeps the copy.
 */
describe("sharing — share a trip", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let eve: TestAccount;
  let full: Awaited<ReturnType<typeof makeFullTrip>>;
  let companionId: string;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    eve = await makeAccount("eve");
    full = await makeFullTrip(anna);
    companionId = (await linkWithConsent(anna, ben)).id;
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const share = (as: TestAccount, tripId: string, withCompanion: string) =>
    request(app)
      .post(`/api/v1/sharing/trips/${tripId}/share`)
      .set("Cookie", as.cookie)
      .send({ companionId: withCompanion });

  const bensTrip = () =>
    prisma.trip.findFirstOrThrow({
      where: { userId: ben.id },
      include: {
        flights: true,
        lodgingStays: { include: { lodging: true } },
        cruises: { include: { stops: { orderBy: { dayNumber: "asc" } } } },
        railJourneys: true,
        rentalBookings: true,
        stops: { orderBy: { orderIdx: "asc" } },
      },
    });

  it("copies the trip and every entry type into the companion's account", async () => {
    const res = await share(anna, full.trip.id, companionId).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tripCreated).toBe(true);
    expect(res.body.data.created).toEqual({
      flights: 1,
      lodgingStays: 1,
      cruises: 1,
      railJourneys: 1,
      rentals: 1,
      stops: 2,
    });

    const copy = await bensTrip();
    const original = await prisma.trip.findUniqueOrThrow({ where: { id: full.trip.id } });
    expect(copy.shareGroupId).toBe(original.shareGroupId);
    expect(copy.shareGroupId).not.toBeNull();
    // Facts as stored — the day and its zone, never re-derived (ADR 0002).
    expect(copy.name).toBe("Lissabon 2025");
    expect(copy.startDay).toEqual(original.startDay);
    expect(copy.endZone).toBe("Europe/Lisbon");
    expect(copy.countries).toEqual(["PT"]);
    // Private: not copied.
    expect(copy.notes).toBeNull();
    expect(copy.tags).toEqual([]);

    const [flight] = copy.flights;
    const ownFlight = await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } });
    expect(flight.userId).toBe(ben.id);
    expect(flight.flightNumber).toBe("TP571");
    expect(flight.departureTime).toEqual(ownFlight.departureTime);
    expect(flight.arrTimezone).toBe("Europe/Lisbon");
    expect(flight.routeDistance).toBe(1900);
    expect(flight.shareKey).toBe(ownFlight.shareKey);
    expect(flight.shareKey).not.toBeNull();
    expect(flight.dataSource).toBe("shared");
    expect(flight.seatNumber).toBeNull();
    expect(flight.seatClass).toBeNull();
    expect(flight.bookingReference).toBeNull();
    expect(flight.price).toBeNull();
    expect(flight.notes).toBeNull();
    expect(flight.tags).toEqual([]);

    const [stay] = copy.lodgingStays;
    expect(stay.userId).toBe(ben.id);
    expect(stay.lodging.userId).toBe(ben.id);
    expect(stay.lodging.id).not.toBe(full.lodging.id);
    expect(stay.lodging.name).toBe("Hotel Avenida Palace");
    expect(stay.checkInDate).toEqual(full.stay.checkInDate);
    expect(stay.stayZone).toBe("Europe/Lisbon");
    expect(stay.board).toBe("breakfast");
    expect(stay.roomNumber).toBeNull();
    expect(stay.totalPrice).toBeNull();
    expect(stay.ratingOverall).toBeNull();
    expect(stay.bookingReference).toBeNull();
    expect(stay.notes).toBeNull();

    const [cruise] = copy.cruises;
    expect(cruise.userId).toBe(ben.id);
    expect(cruise.routeName).toBe("Atlantik");
    expect(cruise.cabinNumber).toBeNull();
    expect(cruise.price).toBeNull();
    expect(cruise.stops.map((s) => [s.dayNumber, s.isAtSea, s.unresolvedPortName])).toEqual([
      [1, true, null],
      [2, false, "Funchal"],
    ]);
    expect(cruise.stops[1].excursionNote).toBeNull();

    const [rail] = copy.railJourneys;
    expect(rail.depStationName).toBe("Lisboa Santa Apolónia");
    expect(rail.departureTime).toEqual(full.rail.departureTime);
    expect(rail.seat).toBeNull();
    expect(rail.coach).toBeNull();
    expect(rail.travelClass).toBeNull();
    expect(rail.price).toBeNull();

    const [rental] = copy.rentalBookings;
    expect(rental.provider).toBe("Sixt");
    expect(rental.pickupTimezone).toBe("Europe/Lisbon");
    expect(rental.licensePlate).toBe("AA-00-BB");
    expect(rental.confirmationNumber).toBeNull();
    expect(rental.price).toBeNull();
    expect(rental.notes).toBeNull();

    // A stop wrapping the flight wraps the recipient's COPY of it.
    expect(copy.stops.map((s) => s.title)).toEqual(["FRA → LIS", "Belém"]);
    expect(copy.stops[0].sourceId).toBe(flight.id);
    expect(copy.stops[0].notes).toBeNull();

    // The sharer's own rows are untouched apart from their keys.
    const own = await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } });
    expect(own.seatNumber).toBe("12A");
    expect(own.userId).toBe(anna.id);
  });

  it("tells the recipient, and the trip view lists the member", async () => {
    await share(anna, full.trip.id, companionId).expect(200);
    const notices = await request(app)
      .get("/api/v1/sharing/notices")
      .set("Cookie", ben.cookie)
      .expect(200);
    const copy = await bensTrip();
    expect(notices.body.data.notices).toHaveLength(1);
    expect(notices.body.data.notices[0]).toMatchObject({
      kind: "shared",
      entityType: "trip",
      entityKey: copy.id,
      actor: { id: anna.id },
      readAt: null,
    });
    const count = await request(app)
      .get("/api/v1/sharing/inbox/count")
      .set("Cookie", ben.cookie)
      .expect(200);
    expect(count.body.data.count).toBe(1);

    await request(app)
      .post(`/api/v1/sharing/notices/${notices.body.data.notices[0].id}/read`)
      .set("Cookie", ben.cookie)
      .expect(200);
    // Someone else's notice cannot be marked.
    await request(app)
      .post(`/api/v1/sharing/notices/${notices.body.data.notices[0].id}/read`)
      .set("Cookie", eve.cookie)
      .expect(404);

    const view = await request(app)
      .get(`/api/v1/sharing/trips/${full.trip.id}`)
      .set("Cookie", anna.cookie)
      .expect(200);
    expect(view.body.data.members.map((m: { id: string }) => m.id)).toEqual([ben.id]);
    expect(view.body.data.candidates).toEqual([
      expect.objectContaining({ companionId, consenting: true, shared: true }),
    ]);
    const bensView = await request(app)
      .get(`/api/v1/sharing/trips/${copy.id}`)
      .set("Cookie", ben.cookie)
      .expect(200);
    expect(bensView.body.data.members.map((m: { id: string }) => m.id)).toEqual([anna.id]);
  });

  it("is idempotent: sharing again adds nothing twice, only what is new", async () => {
    await share(anna, full.trip.id, companionId).expect(200);
    const again = await share(anna, full.trip.id, companionId).expect(200);
    expect(again.body.data.tripCreated).toBe(false);
    expect(Object.values(again.body.data.created).every((n) => n === 0)).toBe(true);
    expect(await prisma.trip.count({ where: { userId: ben.id } })).toBe(1);
    expect(await prisma.flight.count({ where: { userId: ben.id } })).toBe(1);
    expect(await prisma.lodging.count({ where: { userId: ben.id } })).toBe(1);
    expect(await prisma.shareNotice.count({ where: { userId: ben.id } })).toBe(1);

    await prisma.flight.create({
      data: {
        userId: anna.id,
        tripId: full.trip.id,
        flightNumber: "TP572",
        depLat: 38.77,
        depLon: -9.13,
        arrLat: 50.03,
        arrLon: 8.56,
        status: "flown",
      },
    });
    const third = await share(anna, full.trip.id, companionId).expect(200);
    expect(third.body.data.created.flights).toBe(1);
    expect(await prisma.flight.count({ where: { userId: ben.id } })).toBe(2);
  });

  // A name is not a house (security review 2026-10-09): "Hotel Europa" in
  // Berlin and in Rome are two buildings. Name AND place, or a new lodging.
  describe("reusing the recipient's own lodging", () => {
    const bensLodgingAfterShare = async () => {
      await share(anna, full.trip.id, companionId).expect(200);
      return (await bensTrip()).lodgingStays[0].lodgingId;
    };

    it("reuses a same-named house in the same city and country when coordinates are missing", async () => {
      const bensHotel = await prisma.lodging.create({
        data: { userId: ben.id, name: "hotel avenida  PALACE", city: "lisboa", country: "pt" },
      });
      expect(await bensLodgingAfterShare()).toBe(bensHotel.id);
      expect(await prisma.lodging.count({ where: { userId: ben.id } })).toBe(1);
    });

    it("creates a new lodging for the same name in another city", async () => {
      const bensHotel = await prisma.lodging.create({
        data: { userId: ben.id, name: "Hotel Avenida Palace", city: "Porto", country: "PT" },
      });
      expect(await bensLodgingAfterShare()).not.toBe(bensHotel.id);
      expect(await prisma.lodging.count({ where: { userId: ben.id } })).toBe(2);
    });

    it("creates a new lodging for the same name with no place to compare", async () => {
      const bensHotel = await prisma.lodging.create({
        data: { userId: ben.id, name: "Hotel Avenida Palace" },
      });
      expect(await bensLodgingAfterShare()).not.toBe(bensHotel.id);
    });

    it("reuses a same-named house within 300 m", async () => {
      await prisma.lodging.update({
        where: { id: full.lodging.id },
        data: { lat: 38.7155, lon: -9.1418 },
      });
      // ~150 m away, and in a city spelled differently — the coordinates decide.
      const bensHotel = await prisma.lodging.create({
        data: { userId: ben.id, name: "Hotel Avenida Palace", lat: 38.7168, lon: -9.1424 },
      });
      expect(await bensLodgingAfterShare()).toBe(bensHotel.id);
    });

    it("creates a new lodging for a same-named house farther than 300 m", async () => {
      await prisma.lodging.update({
        where: { id: full.lodging.id },
        data: { lat: 38.7155, lon: -9.1418 },
      });
      const bensHotel = await prisma.lodging.create({
        data: {
          userId: ben.id,
          name: "Hotel Avenida Palace",
          city: "Lisboa",
          country: "PT",
          lat: 38.7255,
          lon: -9.1418,
        },
      });
      expect(await bensLodgingAfterShare()).not.toBe(bensHotel.id);
    });
  });

  it("derives the copied stay's status from its dates", async () => {
    await prisma.lodgingStay.update({ where: { id: full.stay.id }, data: { status: "scheduled" } });
    await share(anna, full.trip.id, companionId).expect(200);
    expect((await bensTrip()).lodgingStays[0].status).toBe("completed");
  });

  it("lets each account's statistics count its own copy", async () => {
    const before = await request(app)
      .get("/api/v1/stats/hero")
      .set("Cookie", ben.cookie)
      .expect(200);
    expect(before.body.flights).toBe(0);
    await share(anna, full.trip.id, companionId).expect(200);
    const [annas, bens] = await Promise.all([
      request(app).get("/api/v1/stats/hero").set("Cookie", anna.cookie).expect(200),
      request(app).get("/api/v1/stats/hero").set("Cookie", ben.cookie).expect(200),
    ]);
    expect(annas.body.flights).toBe(1);
    expect(bens.body.flights).toBe(1);
    expect(bens.body.distanceKm).toBe(annas.body.distanceKm);
  });

  it("refuses a companion without an account link, and one whose consent was withdrawn", async () => {
    const plain = await prisma.companion.create({
      data: { userId: anna.id, canonicalName: "carl", displayName: "Carl", searchName: "carl" },
    });
    expect((await share(anna, full.trip.id, plain.id).expect(409)).body.code).toBe(
      "SHARE_COMPANION_NOT_LINKED"
    );
    await prisma.shareConsent.updateMany({
      where: { requesterId: anna.id, targetId: ben.id },
      data: { status: "withdrawn" },
    });
    expect((await share(anna, full.trip.id, companionId).expect(403)).body.code).toBe(
      "SHARE_CONSENT_REQUIRED"
    );
    expect(await prisma.trip.count({ where: { userId: ben.id } })).toBe(0);
    // The refusal left nothing half done on the sharer's side either.
    const own = await prisma.trip.findUniqueOrThrow({ where: { id: full.trip.id } });
    expect(own.shareGroupId).toBeNull();
  });

  it("refuses another account's trip or companion", async () => {
    const evesCompanion = (await linkWithConsent(eve, ben)).id;
    expect((await share(eve, full.trip.id, evesCompanion).expect(404)).body.code).toBe(
      "TRIP_NOT_FOUND"
    );
    const evesTrip = await prisma.trip.create({ data: { userId: eve.id, name: "Eve" } });
    expect((await share(eve, evesTrip.id, companionId).expect(404)).body.code).toBe(
      "COMPANION_NOT_FOUND"
    );
    await request(app)
      .get(`/api/v1/sharing/trips/${full.trip.id}`)
      .set("Cookie", eve.cookie)
      .expect(404);
    await request(app)
      .post(`/api/v1/sharing/trips/${full.trip.id}/leave`)
      .set("Cookie", eve.cookie)
      .expect(404);
    expect(await prisma.trip.count({ where: { userId: ben.id } })).toBe(0);
  });

  it("leaves the group: own copy stays, keys and group cleared, others told", async () => {
    await share(anna, full.trip.id, companionId).expect(200);
    const copy = await bensTrip();
    await request(app)
      .post(`/api/v1/sharing/trips/${copy.id}/leave`)
      .set("Cookie", ben.cookie)
      .expect(200);

    const after = await bensTrip();
    expect(after.shareGroupId).toBeNull();
    expect(after.flights).toHaveLength(1);
    expect(after.flights[0].shareKey).toBeNull();
    expect(after.stops.every((s) => s.shareKey === null)).toBe(true);
    expect(after.cruises[0].shareKey).toBeNull();

    // Anna's trip stays in its (now one-member) group with her keys.
    const own = await prisma.trip.findUniqueOrThrow({ where: { id: full.trip.id } });
    expect(own.shareGroupId).not.toBeNull();
    const notices = await prisma.shareNotice.findMany({ where: { userId: anna.id } });
    expect(notices).toEqual([
      expect.objectContaining({ kind: "left", actorId: ben.id, entityKey: full.trip.id }),
    ]);

    const twice = await request(app)
      .post(`/api/v1/sharing/trips/${copy.id}/leave`)
      .set("Cookie", ben.cookie)
      .expect(409);
    expect(twice.body.code).toBe("SHARE_TRIP_NOT_SHARED");
  });

  it("dissolves a group nobody is left in", async () => {
    await share(anna, full.trip.id, companionId).expect(200);
    const copy = await bensTrip();
    const groupId = copy.shareGroupId as string;
    await request(app)
      .post(`/api/v1/sharing/trips/${copy.id}/leave`)
      .set("Cookie", ben.cookie)
      .expect(200);
    await request(app)
      .post(`/api/v1/sharing/trips/${full.trip.id}/leave`)
      .set("Cookie", anna.cookie)
      .expect(200);
    expect(await prisma.tripShareGroup.count({ where: { id: groupId } })).toBe(0);
  });
});
