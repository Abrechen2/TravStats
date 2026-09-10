import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * A reference in a request body must point at something the sender owns.
 *
 * Every one of these write paths verified the record it was nested under — the
 * hotel, the cruise — and then handed the foreign keys from the body straight
 * to Prisma, which enforces that a row EXISTS and never whose it is. So account
 * A could file a hotel stay against account B's trip, and B's trip detail then
 * returned A's stay with its dates and its price on B's own timeline (audit
 * finding AUD-038). The loyalty `membershipId` and a cruise's trip and booking
 * had the same hole.
 *
 * The last case is the one that shows why this is not merely untidy: the leak
 * runs towards the victim, so it needs no cooperation from them and shows up in
 * their own data.
 *
 * 404 rather than 403 is deliberate — see `utils/ownedReferences.ts`.
 */
const NAMES = ["xrefs-owner", "xrefs-stranger"];

describe("cross-account references", () => {
  let ownerId: string;
  let strangerId: string;
  let ownerCookie: string;
  let strangerCookie: string;

  /** Objects belonging to the OWNER — the stranger will try to link to them. */
  let ownerTripId: string;
  let ownerBookingId: string;
  let ownerMembershipId: string;

  /** The stranger's own hotel, the record their writes are nested under. */
  let strangerLodgingId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: NAMES } } });

    const owner = await prisma.user.create({
      data: { username: NAMES[0], passwordHash: await hashPassword("password123") },
    });
    const stranger = await prisma.user.create({
      data: { username: NAMES[1], passwordHash: await hashPassword("password123") },
    });
    ownerId = owner.id;
    strangerId = stranger.id;
    ownerCookie = `auth_token=${generateToken(ownerId)}`;
    strangerCookie = `auth_token=${generateToken(strangerId)}`;

    const trip = await prisma.trip.create({
      data: { userId: ownerId, name: "Owner trip", startDate: new Date("2026-03-01") },
    });
    ownerTripId = trip.id;

    const booking = await prisma.booking.create({ data: { userId: ownerId, pnr: "OWNR01" } });
    ownerBookingId = booking.id;

    const membership = await prisma.lodgingMembership.create({
      data: { userId: ownerId, programName: "Owner Rewards" },
    });
    ownerMembershipId = membership.id;

    const lodging = await prisma.lodging.create({
      data: { userId: strangerId, name: "Stranger Hotel", type: "hotel" },
    });
    strangerLodgingId = lodging.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } }).catch(() => {});
    await prisma.$disconnect();
  });

  /** A stay of the stranger's own, to PATCH in the re-linking cases. */
  async function createStrangerStay(): Promise<string> {
    const res = await request(app)
      .post(`/api/v1/lodging/${strangerLodgingId}/stays`)
      .set("Cookie", strangerCookie)
      .send({ checkIn: "2026-03-02T00:00:00.000Z", checkOut: "2026-03-04T00:00:00.000Z" });
    expect(res.status).toBe(201);
    return (res.body.data ?? res.body).id;
  }

  describe("a hotel stay", () => {
    it.each([
      ["trip", () => ({ tripId: ownerTripId })],
      ["booking", () => ({ bookingId: ownerBookingId })],
      ["membership", () => ({ membershipId: ownerMembershipId })],
    ])("cannot be created against someone else's %s", async (_label, ref) => {
      const res = await request(app)
        .post(`/api/v1/lodging/${strangerLodgingId}/stays`)
        .set("Cookie", strangerCookie)
        .send({
          checkIn: "2026-03-02T00:00:00.000Z",
          checkOut: "2026-03-04T00:00:00.000Z",
          ...ref(),
        });

      expect(res.status).toBe(404);
    });

    it.each([
      ["trip", () => ({ tripId: ownerTripId })],
      ["booking", () => ({ bookingId: ownerBookingId })],
      ["membership", () => ({ membershipId: ownerMembershipId })],
    ])("cannot be re-linked to someone else's %s", async (_label, ref) => {
      const stayId = await createStrangerStay();

      const res = await request(app)
        .patch(`/api/v1/lodging/${strangerLodgingId}/stays/${stayId}`)
        .set("Cookie", strangerCookie)
        .send(ref());

      expect(res.status).toBe(404);

      // And the refusal is real, not just a status code: nothing was written.
      const stored = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stored.tripId).toBeNull();
      expect(stored.bookingId).toBeNull();
      expect(stored.membershipId).toBeNull();
    });
  });

  describe("a cruise", () => {
    const cruisePayload = {
      cruiseLine: "Test Line",
      shipName: "MS Probe",
      startDate: "2026-03-02T00:00:00.000Z",
      endDate: "2026-03-09T00:00:00.000Z",
    };

    it.each([
      ["trip", () => ({ tripId: ownerTripId })],
      ["booking", () => ({ bookingId: ownerBookingId })],
    ])("cannot be created against someone else's %s", async (_label, ref) => {
      const res = await request(app)
        .post("/api/v1/cruises")
        .set("Cookie", strangerCookie)
        .send({ ...cruisePayload, ...ref() });

      expect(res.status).toBe(404);
    });
  });

  /**
   * The victim's view is the point of the finding, so it gets its own
   * assertion: the owner's trip shows the owner's own stay and nothing else.
   *
   * The owner's stay is created FIRST and asserted to be visible. Without it
   * this test passes for the wrong reason — an empty list proves nothing when
   * the query might be unable to return anything at all.
   */
  it("leaves the owner's trip holding only the owner's own records", async () => {
    const ownerLodging = await prisma.lodging.create({
      data: { userId: ownerId, name: "Owner Hotel", type: "hotel" },
    });
    const ownStay = await request(app)
      .post(`/api/v1/lodging/${ownerLodging.id}/stays`)
      .set("Cookie", ownerCookie)
      .send({
        checkIn: "2026-03-02T00:00:00.000Z",
        checkOut: "2026-03-04T00:00:00.000Z",
        tripId: ownerTripId,
      });
    expect(ownStay.status).toBe(201);
    const ownStayId = (ownStay.body.data ?? ownStay.body).id;

    const strangerStayId = await createStrangerStay();
    await request(app)
      .patch(`/api/v1/lodging/${strangerLodgingId}/stays/${strangerStayId}`)
      .set("Cookie", strangerCookie)
      .send({ tripId: ownerTripId });

    // `{ trip: ... }` — this router answers bare, and the wrapper is named.
    const res = await request(app)
      .get(`/api/v1/trips/${ownerTripId}`)
      .set("Cookie", ownerCookie);

    expect(res.status).toBe(200);
    const stays: Array<{ id: string }> = res.body.trip.lodgingStays;
    expect(stays.map((s) => s.id)).toEqual([ownStayId]);
  });
});
