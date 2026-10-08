import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { rentalCreationLimiter } from "../../middleware/rateLimit";

/**
 * The ACTUAL hand-over times of a rental, read like the booked ones (ADR 0002):
 * each on its station's clock, with its own fold key for the repeated autumn
 * hour, a bare day kept as a day, and an actual return before the actual
 * pickup refused — compared as instants, across the two stations' zones.
 *
 * Berlin left summer time on 25 Oct 2026 at 03:00: 02:30 happened twice, at
 * 00:30Z (CEST) and an hour later at 01:30Z (CET). Every value is invented.
 */
describe("Rental actual times", () => {
  let cookie: string;
  let userId: string;

  const create = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/rentals").set("Cookie", cookie).send(body);
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/rentals/${id}`).set("Cookie", cookie).send(body);

  const FRA = { iata: "FRA", name: "Frankfurt Flughafen" };
  const autumn = {
    provider: "Testcar",
    pickupStation: FRA,
    pickupLocal: "2026-10-24T10:00",
    returnLocal: "2026-10-26T10:00",
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "rentalactual" } });
    const user = await prisma.user.create({
      data: { username: "rentalactual", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterEach(async () => {
    await prisma.rentalBooking.deleteMany({ where: { userId } });
    await rentalCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("the repeated autumn hour", () => {
    it("reads an actual pickup at 02:30 as the earlier occurrence by default", async () => {
      const res = await create({ ...autumn, actualPickupLocal: "2026-10-25T02:30" });
      expect(res.status).toBe(201);
      expect(res.body.data.actualPickupTime).toBe("2026-10-25T00:30:00.000Z");
      expect(res.body.data.times.actualPickup).toMatchObject({
        local: "2026-10-25T02:30:00",
        offset: "+02:00",
        precision: "minute",
      });
    });

    it("stores the later occurrence of an actual pickup when actualPickupFold says so", async () => {
      const res = await create({
        ...autumn,
        actualPickupLocal: "2026-10-25T02:30",
        actualPickupFold: "later",
      });
      expect(res.status).toBe(201);
      expect(res.body.data.actualPickupTime).toBe("2026-10-25T01:30:00.000Z");
      expect(res.body.data.times.actualPickup).toMatchObject({
        local: "2026-10-25T02:30:00",
        offset: "+01:00",
      });
    });

    it("reads an actual return in the repeated hour earlier or later, as its fold says", async () => {
      const id = (await create(autumn)).body.data.id;
      const earlier = await patch(id, { actualReturnLocal: "2026-10-25T02:30" });
      expect(earlier.status).toBe(200);
      expect(earlier.body.data.actualReturnTime).toBe("2026-10-25T00:30:00.000Z");
      const later = await patch(id, {
        actualReturnLocal: "2026-10-25T02:30",
        actualReturnFold: "later",
      });
      expect(later.status).toBe(200);
      expect(later.body.data.actualReturnTime).toBe("2026-10-25T01:30:00.000Z");
      expect(later.body.data.times.actualReturn.offset).toBe("+01:00");
    });

    it("keeps a stored later occurrence through a PATCH that does not send the time", async () => {
      const id = (
        await create({
          ...autumn,
          actualReturnLocal: "2026-10-25T02:30",
          actualReturnFold: "later",
        })
      ).body.data.id;
      const res = await patch(id, { notes: "Schlüssel im Kasten" });
      expect(res.status).toBe(200);
      expect(res.body.data.actualReturnTime).toBe("2026-10-25T01:30:00.000Z");
    });

    it("never records a fold key as a field edited by hand", async () => {
      const res = await create({
        ...autumn,
        actualPickupLocal: "2026-10-25T02:30",
        actualPickupFold: "later",
      });
      expect(res.body.data.userEditedFields).toContain("actualPickupLocal");
      expect(res.body.data.userEditedFields).not.toContain("actualPickupFold");
    });

    it("still refuses a misspelt actual fold key", async () => {
      const res = await create({ ...autumn, actualReturnFolds: "later" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("RENTAL_INVALID_INPUT");
      expect(res.body.field).toBe("actualReturnFolds");
    });
  });

  describe("a day-only actual end", () => {
    it("round-trips as a day: stored with precision day, read back as the day", async () => {
      const res = await create({
        ...autumn,
        pickupLocal: "2026-07-01T10:00",
        returnLocal: "2026-07-05T09:30",
        actualReturnLocal: "2026-07-05",
      });
      expect(res.status).toBe(201);
      expect(res.body.data.actualReturnPrecision).toBe("day");
      expect(res.body.data.times.actualReturn).toMatchObject({
        local: "2026-07-05T00:00:00",
        precision: "day",
      });
      // A write that does not touch it keeps it a day, not a midnight.
      const kept = await patch(res.body.data.id, { notes: "x" });
      expect(kept.body.data.times.actualReturn.precision).toBe("day");
      // Sending the day back (what a form does) changes nothing.
      const again = await patch(res.body.data.id, { actualReturnLocal: "2026-07-05" });
      expect(again.body.data.actualReturnTime).toBe(res.body.data.actualReturnTime);
      expect(again.body.data.times.actualReturn.precision).toBe("day");
    });

    it("turns a day into a minute when a clock is sent, and clears with null", async () => {
      const id = (
        await create({
          ...autumn,
          pickupLocal: "2026-07-01T10:00",
          returnLocal: "2026-07-05T09:30",
          actualPickupLocal: "2026-07-01",
        })
      ).body.data.id;
      const timed = await patch(id, { actualPickupLocal: "2026-07-01T10:12" });
      expect(timed.body.data.times.actualPickup.precision).toBe("minute");
      const cleared = await patch(id, { actualPickupLocal: null });
      expect(cleared.body.data.actualPickupTime).toBeNull();
      expect(cleared.body.data.actualPickupPrecision).toBeNull();
      expect(cleared.body.data.times.actualPickup).toBeNull();
    });

    it("does not refuse a day-only return recorded on the actual pickup's own day", async () => {
      const res = await create({
        ...autumn,
        pickupLocal: "2026-07-01T10:00",
        returnLocal: "2026-07-01T18:00",
        actualPickupLocal: "2026-07-01T10:05",
        actualReturnLocal: "2026-07-01",
      });
      expect(res.status).toBe(201);
    });
  });

  describe("the actual return must not precede the actual pickup", () => {
    it("refuses it on create, naming the return", async () => {
      const res = await create({
        ...autumn,
        actualPickupLocal: "2026-10-24T10:00",
        actualReturnLocal: "2026-10-24T09:00",
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("RENTAL_ACTUAL_RETURN_BEFORE_PICKUP");
      expect(res.body.field).toBe("actualReturnLocal");
    });

    it("names the pickup when a PATCH moved only the pickup past the stored return", async () => {
      const id = (
        await create({
          ...autumn,
          actualPickupLocal: "2026-10-24T10:00",
          actualReturnLocal: "2026-10-26T09:00",
        })
      ).body.data.id;
      const res = await patch(id, { actualPickupLocal: "2026-10-26T12:00" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("RENTAL_ACTUAL_RETURN_BEFORE_PICKUP");
      expect(res.body.field).toBe("actualPickupLocal");
      // Nothing was written.
      const row = await prisma.rentalBooking.findUniqueOrThrow({ where: { id } });
      expect(row.actualPickupTime?.toISOString()).toBe("2026-10-24T08:00:00.000Z");
    });

    it("compares instants across zones: a later-looking clock can be the earlier moment", async () => {
      // Picked up in Los Angeles at 18:00 (01:00Z next day), returned in New
      // York at 20:00 the same calendar day (00:00Z) — an hour BEFORE.
      const res = await create({
        provider: "Testcar",
        pickupStation: { iata: "LAX", name: "Los Angeles Airport" },
        returnStation: { iata: "JFK", name: "New York JFK" },
        pickupLocal: "2026-07-01T09:00",
        returnLocal: "2026-07-08T18:00",
        actualPickupLocal: "2026-07-01T18:00",
        actualReturnLocal: "2026-07-01T20:00",
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("RENTAL_ACTUAL_RETURN_BEFORE_PICKUP");
    });

    it("accepts an earlier-looking clock that is the later moment", async () => {
      // Picked up in New York at 10:00 (14:00Z), returned in Los Angeles at
      // 08:00 (15:00Z) — an hour AFTER.
      const res = await create({
        provider: "Testcar",
        pickupStation: { iata: "JFK", name: "New York JFK" },
        returnStation: { iata: "LAX", name: "Los Angeles Airport" },
        pickupLocal: "2026-07-01T09:00",
        returnLocal: "2026-07-08T18:00",
        actualPickupLocal: "2026-07-01T10:00",
        actualReturnLocal: "2026-07-01T08:00",
      });
      expect(res.status).toBe(201);
    });

    it("orders the two occurrences of the repeated hour by their folds", async () => {
      // 02:30 (later, 01:30Z) then 02:10 (later, 01:10Z) is backwards …
      const backwards = await create({
        ...autumn,
        actualPickupLocal: "2026-10-25T02:30",
        actualPickupFold: "later",
        actualReturnLocal: "2026-10-25T02:10",
        actualReturnFold: "later",
      });
      expect(backwards.status).toBe(400);
      expect(backwards.body.code).toBe("RENTAL_ACTUAL_RETURN_BEFORE_PICKUP");
      // … while 02:30 (earlier, 00:30Z) then 02:10 (later, 01:10Z) is forty minutes on.
      const forwards = await create({
        ...autumn,
        actualPickupLocal: "2026-10-25T02:30",
        actualReturnLocal: "2026-10-25T02:10",
        actualReturnFold: "later",
      });
      expect(forwards.status).toBe(201);
    });

    it("leaves a client that sends no actual keys alone", async () => {
      const id = (
        await create({
          ...autumn,
          actualPickupLocal: "2026-10-24T10:00",
          actualReturnLocal: "2026-10-26T09:00",
        })
      ).body.data.id;
      const res = await patch(id, { pickupLocal: "2026-10-24T09:00", pickupFold: "earlier" });
      expect(res.status).toBe(200);
      expect(res.body.data.actualPickupTime).toBe("2026-10-24T08:00:00.000Z");
      expect(res.body.data.actualReturnTime).toBe("2026-10-26T08:00:00.000Z");
    });
  });
});
