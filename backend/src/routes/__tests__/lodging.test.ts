import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as fx from "../../services/fx/resolver";
import * as geo from "../../services/geo/nominatim";

describe("Lodging API", () => {
  let authCookie: string;
  let userId: string;
  let otherUserId: string;
  let lodgingId: string;

  beforeAll(async () => {
    await prisma.lodgingStay.deleteMany({
      where: { user: { username: { in: ["lodgingtest", "lodgingother"] } } },
    });
    await prisma.lodging.deleteMany({
      where: { user: { username: { in: ["lodgingtest", "lodgingother"] } } },
    });
    await prisma.user.deleteMany({ where: { username: { in: ["lodgingtest", "lodgingother"] } } });

    const u = await prisma.user.create({
      data: { username: "lodgingtest", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: "lodgingother", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;

    // Explicit settings row with baseCurrency=EUR (the DB default), so
    // getBaseCurrency() reads a real row rather than falling back.
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });

    const lodging = await prisma.lodging.create({
      data: { userId, name: "Grand Hotel Zürich", city: "Zürich", country: "CH" },
    });
    lodgingId = lodging.id;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.lodging.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.userSettings.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  describe("POST /api/v1/lodging/:id/stays — FX snapshot on write", () => {
    it("snapshots a CHF stay into EUR base on create", async () => {
      jest
        .spyOn(fx, "convertToBase")
        .mockResolvedValue({ baseAmount: 424.45, rate: 1.0106, rateDate: "2024-05-13", source: "ecb" });
      const res = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2024-05-13T15:00:00.000Z",
          checkOut: "2024-05-15T11:00:00.000Z",
          totalPrice: 420,
          currency: "CHF",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.totalPriceBase).toBe(424.45);
      expect(res.body.data.fxRate).toBeCloseTo(1.0106, 4);
      expect(res.body.data.fxBaseCurrency).toBe("EUR");
    });

    it("sets base = original for a same-currency stay (no network call)", async () => {
      const spy = jest.spyOn(fx, "convertToBase");
      const res = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2024-06-01T15:00:00.000Z",
          checkOut: "2024-06-02T11:00:00.000Z",
          totalPrice: 150,
          currency: "EUR",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.totalPriceBase).toBe(150);
      expect(res.body.data.fxRate).toBe(1);
      expect(res.body.data.fxBaseCurrency).toBe("EUR");
      // convertToBase short-circuits from===base before any fetch — still
      // "called" (it's the real implementation), just never hits the network.
      expect(spy).toHaveBeenCalledWith(150, "EUR", "EUR", expect.any(Date));
    });

    it("saves the stay even when FX fails (no base value)", async () => {
      jest.spyOn(fx, "convertToBase").mockResolvedValue(null);
      const res = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2024-07-01T15:00:00.000Z",
          checkOut: "2024-07-02T11:00:00.000Z",
          totalPrice: 200,
          currency: "USD",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.totalPriceBase).toBeNull();
      expect(res.body.data.fxRate).toBeNull();
      expect(res.body.data.fxBaseCurrency).toBeNull();
    });

    it("clears the FX snapshot when no totalPrice is given (never calls FX)", async () => {
      const spy = jest.spyOn(fx, "convertToBase");
      const res = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({ checkIn: "2024-07-10T15:00:00.000Z", checkOut: "2024-07-11T11:00:00.000Z" });
      expect(res.status).toBe(201);
      expect(res.body.data.totalPriceBase).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    });

    it("passes the check-in calendar day (UTC) to convertToBase, unshifted", async () => {
      // A late-evening UTC check-in must snapshot the SAME calendar day, not
      // the next one — this is the reviewer-flagged UTC-consistency gotcha.
      const spy = jest
        .spyOn(fx, "convertToBase")
        .mockResolvedValue({ baseAmount: 100, rate: 1, rateDate: "2024-08-20", source: "ecb" });
      await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2024-08-20T23:30:00.000Z",
          checkOut: "2024-08-21T10:00:00.000Z",
          totalPrice: 100,
          currency: "USD",
        });
      const passedDate = spy.mock.calls[0][3] as Date;
      expect(passedDate.toISOString().slice(0, 10)).toBe("2024-08-20");
    });

    it("returns 404 when the lodging does not exist", async () => {
      const res = await request(app)
        .post("/api/v1/lodging/00000000-0000-0000-0000-000000000000/stays")
        .set("Cookie", authCookie)
        .send({ checkIn: "2024-07-01T00:00:00.000Z", checkOut: "2024-07-02T00:00:00.000Z" });
      expect(res.status).toBe(404);
    });

    it("requires authentication", async () => {
      const res = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .send({ checkIn: "2024-07-01T00:00:00.000Z", checkOut: "2024-07-02T00:00:00.000Z" });
      expect(res.status).toBe(401);
    });
  });

  describe("totalPrice is derived on write (#4)", () => {
    it("stores total = per-night x nights when only a per-night price is sent", async () => {
      const res = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2024-08-01T00:00:00.000Z",
          checkOut: "2024-08-04T00:00:00.000Z", // 3 nights
          pricePerNight: 95,
          currency: "EUR",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.totalPrice).toBe(285);
      // and the FX snapshot converted the DERIVED total, not null
      expect(res.body.data.totalPriceBase).toBe(285);
    });

    it("keeps an explicit total over per-night x nights", async () => {
      const res = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2024-08-10T00:00:00.000Z",
          checkOut: "2024-08-13T00:00:00.000Z", // 3 nights -> 285 if derived
          totalPrice: 249, // package rate wins
          pricePerNight: 95,
          currency: "EUR",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.totalPrice).toBe(249);
    });

    it("re-derives the total when a PATCH changes only the per-night price", async () => {
      const created = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2024-09-01T00:00:00.000Z",
          checkOut: "2024-09-03T00:00:00.000Z", // 2 nights
          pricePerNight: 80,
          currency: "EUR",
        });
      expect(created.body.data.totalPrice).toBe(160);

      const patched = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}/stays/${created.body.data.id}`)
        .set("Cookie", authCookie)
        .send({ pricePerNight: 120 });
      expect(patched.status).toBe(200);
      expect(patched.body.data.totalPrice).toBe(240);
    });
  });

  describe("GET /api/v1/lodging/fx-preview — live rate preview (never the authoritative snapshot)", () => {
    it("returns a conversion preview for a differing currency", async () => {
      jest
        .spyOn(fx, "convertToBase")
        .mockResolvedValue({ baseAmount: 391.23, rate: 0.9315, rateDate: "2026-07-11", source: "ecb" });
      const res = await request(app)
        .get("/api/v1/lodging/fx-preview")
        .query({ amount: 420, from: "CHF", date: "2026-07-11" })
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      // `source` joined the payload with the provider chain: the editor has to
      // be able to say WHICH source answered, and never label an estimate ECB.
      expect(res.body.data).toEqual({ baseAmount: 391.23, rate: 0.9315, rateDate: "2026-07-11", source: "ecb", baseCurrency: "EUR" });
    });

    it("returns null data (never a broken partial) when the ECB lookup fails", async () => {
      jest.spyOn(fx, "convertToBase").mockResolvedValue(null);
      const res = await request(app)
        .get("/api/v1/lodging/fx-preview")
        .query({ amount: 420, from: "CHF", date: "2026-07-11" })
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it("never matches the /:id route — 'fx-preview' is not treated as a lodging id", async () => {
      const res = await request(app)
        .get("/api/v1/lodging/fx-preview")
        .query({ amount: 100, from: "USD", date: "2026-01-01" })
        .set("Cookie", authCookie);
      expect(res.status).not.toBe(404);
    });

    it("rejects an unknown currency code", async () => {
      const res = await request(app)
        .get("/api/v1/lodging/fx-preview")
        .query({ amount: 100, from: "XXX", date: "2026-01-01" })
        .set("Cookie", authCookie);
      expect(res.status).toBe(400);
    });

    it("requires authentication", async () => {
      const res = await request(app)
        .get("/api/v1/lodging/fx-preview")
        .query({ amount: 100, from: "USD", date: "2026-01-01" });
      expect(res.status).toBe(401);
    });
  });

  describe("PATCH /api/v1/lodging/:id/stays/:stayId — selective FX re-snapshot", () => {
    let stayId: string;

    beforeAll(async () => {
      jest
        .spyOn(fx, "convertToBase")
        .mockResolvedValue({ baseAmount: 100, rate: 1, rateDate: "2024-08-01", source: "ecb" });
      const res = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2024-08-01T15:00:00.000Z",
          checkOut: "2024-08-02T11:00:00.000Z",
          totalPrice: 100,
          currency: "EUR",
        });
      stayId = res.body.data.id;
      jest.restoreAllMocks();
    });

    it("does not touch a previously-good FX snapshot on an unrelated field edit", async () => {
      const spy = jest.spyOn(fx, "convertToBase");
      const res = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}/stays/${stayId}`)
        .set("Cookie", authCookie)
        .send({ notes: "Lovely stay" });
      expect(res.status).toBe(200);
      expect(res.body.data.totalPriceBase).toBe(100);
      expect(res.body.data.notes).toBe("Lovely stay");
      expect(spy).not.toHaveBeenCalled();
    });

    it("re-snapshots FX when totalPrice changes", async () => {
      jest.spyOn(fx, "convertToBase").mockResolvedValue({ baseAmount: 250, rate: 1, rateDate: "2024-08-01", source: "ecb" });
      const res = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}/stays/${stayId}`)
        .set("Cookie", authCookie)
        .send({ totalPrice: 250 });
      expect(res.status).toBe(200);
      expect(res.body.data.totalPriceBase).toBe(250);
    });

    it("re-snapshots FX when currency changes, using the existing totalPrice", async () => {
      const spy = jest
        .spyOn(fx, "convertToBase")
        .mockResolvedValue({ baseAmount: 999, rate: 3.996, rateDate: "2024-08-01", source: "ecb" });
      const res = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}/stays/${stayId}`)
        .set("Cookie", authCookie)
        .send({ currency: "USD" });
      expect(res.status).toBe(200);
      expect(res.body.data.totalPriceBase).toBe(999);
      expect(spy).toHaveBeenCalledWith(250, "USD", "EUR", expect.any(Date));
    });

    it("returns 404 for a stay that does not belong to the given lodging", async () => {
      const otherLodging = await prisma.lodging.create({ data: { userId, name: "Other Own Hotel" } });
      const res = await request(app)
        .patch(`/api/v1/lodging/${otherLodging.id}/stays/${stayId}`)
        .set("Cookie", authCookie)
        .send({ notes: "x" });
      expect(res.status).toBe(404);
    });

    it("rejects an empty PATCH body — no silent no-op (finding 4)", async () => {
      const res = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}/stays/${stayId}`)
        .set("Cookie", authCookie)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/v1/lodging/:id/stays/:stayId — full-shape PATCH from the real editor (finding 1 CRITICAL)", () => {
    // StayEditor.tsx sends checkIn/checkOut/status/currency/board/isAwardStay
    // UNCONDITIONALLY on every save, plus totalPrice whenever the price field
    // is non-empty (it re-sends the stay's existing value on a notes-only
    // edit too) — never a minimal `{ notes: ... }` body. This is exactly the
    // shape the pre-fix `"totalPrice" in input` key-presence guard mistook
    // for "FX inputs changed" on EVERY edit, so a failed FX lookup silently
    // nuked a good historical snapshot. These tests reproduce that shape.
    let editorLodgingId: string;
    let editorStayId: string;
    const originalCheckIn = "2025-02-01T15:00:00.000Z";
    const originalCheckOut = "2025-02-03T11:00:00.000Z";

    const fullEditorPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
      checkIn: originalCheckIn,
      checkOut: originalCheckOut,
      status: "completed",
      currency: "EUR",
      board: "breakfast",
      isAwardStay: false,
      totalPrice: 100,
      ...overrides,
    });

    beforeEach(async () => {
      jest
        .spyOn(fx, "convertToBase")
        .mockResolvedValue({ baseAmount: 100, rate: 1, rateDate: "2025-02-01", source: "ecb" });
      const l = await prisma.lodging.create({ data: { userId, name: "Editor Shape Hotel" } });
      editorLodgingId = l.id;
      const res = await request(app)
        .post(`/api/v1/lodging/${editorLodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: originalCheckIn,
          checkOut: originalCheckOut,
          currency: "EUR",
          totalPrice: 100,
        });
      editorStayId = res.body.data.id;
      jest.restoreAllMocks();
    });

    it("leaves a good snapshot untouched on a notes-only edit that resends the SAME price/currency/checkIn, even when FX is down", async () => {
      const spy = jest.spyOn(fx, "convertToBase").mockResolvedValue(null);
      const res = await request(app)
        .patch(`/api/v1/lodging/${editorLodgingId}/stays/${editorStayId}`)
        .set("Cookie", authCookie)
        .send(fullEditorPayload({ notes: "Updated notes only" }));

      expect(res.status).toBe(200);
      expect(res.body.data.totalPriceBase).toBe(100);
      expect(res.body.data.fxRate).toBe(1);
      expect(res.body.data.fxBaseCurrency).toBe("EUR");
      expect(res.body.data.notes).toBe("Updated notes only");
      // The values are unchanged relative to the stored row, so FX must
      // never even be re-attempted.
      expect(spy).not.toHaveBeenCalled();
    });

    it("clears the snapshot when totalPrice genuinely changes and the FX lookup then fails", async () => {
      jest.spyOn(fx, "convertToBase").mockResolvedValue(null);
      const res = await request(app)
        .patch(`/api/v1/lodging/${editorLodgingId}/stays/${editorStayId}`)
        .set("Cookie", authCookie)
        .send(fullEditorPayload({ totalPrice: 300 }));

      expect(res.status).toBe(200);
      expect(res.body.data.totalPrice).toBe(300);
      expect(res.body.data.totalPriceBase).toBeNull();
      expect(res.body.data.fxRate).toBeNull();
      expect(res.body.data.fxBaseCurrency).toBeNull();
    });

    it("clears the snapshot when the price is explicitly removed (totalPrice: null)", async () => {
      const spy = jest.spyOn(fx, "convertToBase");
      const res = await request(app)
        .patch(`/api/v1/lodging/${editorLodgingId}/stays/${editorStayId}`)
        .set("Cookie", authCookie)
        .send(fullEditorPayload({ totalPrice: null }));

      expect(res.status).toBe(200);
      expect(res.body.data.totalPrice).toBeNull();
      expect(res.body.data.totalPriceBase).toBeNull();
      expect(res.body.data.fxRate).toBeNull();
      expect(res.body.data.fxBaseCurrency).toBeNull();
      // An explicit removal never needs a rate lookup.
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /api/v1/lodging/:id/stays/:stayId — merged effective date validation (finding 3)", () => {
    let dateLodgingId: string;
    let dateStayId: string;

    beforeAll(async () => {
      const l = await prisma.lodging.create({ data: { userId, name: "Date Order Test Hotel" } });
      dateLodgingId = l.id;
      const stay = await prisma.lodgingStay.create({
        data: {
          lodgingId: l.id,
          userId,
          checkIn: new Date("2024-10-10T15:00:00.000Z"),
          checkOut: new Date("2024-10-12T11:00:00.000Z"),
        },
      });
      dateStayId = stay.id;
    });

    it("rejects a checkIn-only PATCH landing after the existing checkOut (row unchanged)", async () => {
      const res = await request(app)
        .patch(`/api/v1/lodging/${dateLodgingId}/stays/${dateStayId}`)
        .set("Cookie", authCookie)
        .send({ checkIn: "2024-10-13T00:00:00.000Z" });
      expect(res.status).toBe(400);
      const stay = await prisma.lodgingStay.findUnique({ where: { id: dateStayId } });
      expect(stay?.checkIn.toISOString()).toBe("2024-10-10T15:00:00.000Z");
    });

    it("rejects a checkOut-only PATCH landing before the existing checkIn (row unchanged)", async () => {
      const res = await request(app)
        .patch(`/api/v1/lodging/${dateLodgingId}/stays/${dateStayId}`)
        .set("Cookie", authCookie)
        .send({ checkOut: "2024-10-09T00:00:00.000Z" });
      expect(res.status).toBe(400);
      const stay = await prisma.lodgingStay.findUnique({ where: { id: dateStayId } });
      expect(stay?.checkOut.toISOString()).toBe("2024-10-12T11:00:00.000Z");
    });

    it("accepts a legitimate single-date PATCH that keeps the order valid", async () => {
      const res = await request(app)
        .patch(`/api/v1/lodging/${dateLodgingId}/stays/${dateStayId}`)
        .set("Cookie", authCookie)
        .send({ checkOut: "2024-10-14T00:00:00.000Z" });
      expect(res.status).toBe(200);
      expect(res.body.data.checkOut).toBe("2024-10-14T00:00:00.000Z");
    });
  });

  describe("POST/PATCH /api/v1/lodging/:id/stays — overall rating is derived server-side", () => {
    let ratingLodgingId: string;

    beforeAll(async () => {
      const l = await prisma.lodging.create({ data: { userId, name: "Rating Derivation Hotel" } });
      ratingLodgingId = l.id;
    });

    const createStay = (body: Record<string, unknown>) =>
      request(app)
        .post(`/api/v1/lodging/${ratingLodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2024-03-01T15:00:00.000Z",
          checkOut: "2024-03-03T11:00:00.000Z",
          ...body,
        });

    it("derives the overall from the components on create, even with none sent", async () => {
      const res = await createStay({ ratingRoom: 4, ratingBreakfast: 5, ratingService: null });
      expect(res.status).toBe(201);
      expect(res.body.data.ratingOverall).toBe(4.5);
    });

    it("overrides a client-sent overall that contradicts the components", async () => {
      const res = await createStay({
        ratingRoom: 5,
        ratingBreakfast: 5,
        ratingService: 5,
        ratingOverall: 2,
      });
      expect(res.status).toBe(201);
      expect(res.body.data.ratingOverall).toBe(5);
    });

    it("keeps an overall sent without any component rating", async () => {
      const res = await createStay({ ratingOverall: 4 });
      expect(res.status).toBe(201);
      expect(res.body.data.ratingOverall).toBe(4);
    });

    it("re-derives from the MERGED ratings when a PATCH changes only one component", async () => {
      // The same merge trap the dates and the FX snapshot already have: a PATCH
      // that sends one rating must derive against the row that will actually be
      // stored, not against the partial body.
      const created = await createStay({ ratingRoom: 3, ratingBreakfast: 3, ratingService: 3 });
      expect(created.body.data.ratingOverall).toBe(3);

      const res = await request(app)
        .patch(`/api/v1/lodging/${ratingLodgingId}/stays/${created.body.data.id}`)
        .set("Cookie", authCookie)
        .send({ ratingRoom: 5 });
      expect(res.status).toBe(200);
      // mean(5, 3, 3) = 3.666… -> 3.5
      expect(res.body.data.ratingOverall).toBe(3.5);
    });

    it("re-derives when a PATCH clears a component to null", async () => {
      const created = await createStay({ ratingRoom: 5, ratingBreakfast: 2, ratingService: null });
      expect(created.body.data.ratingOverall).toBe(3.5);

      const res = await request(app)
        .patch(`/api/v1/lodging/${ratingLodgingId}/stays/${created.body.data.id}`)
        .set("Cookie", authCookie)
        .send({ ratingBreakfast: null });
      expect(res.status).toBe(200);
      expect(res.body.data.ratingOverall).toBe(5);
    });
  });

  describe("POST/PATCH /api/v1/lodging — geocode on save (Task 5b)", () => {
    it("geocodes an address-only lodging on create", async () => {
      jest.spyOn(geo, "resolveCoordinates").mockResolvedValue({ lat: 47.3769, lon: 8.5417 });
      const res = await request(app)
        .post("/api/v1/lodging")
        .set("Cookie", authCookie)
        .send({ name: "Hotel Zürich", city: "Zürich" });
      expect(res.status).toBe(201);
      expect(res.body.data.lat).toBeCloseTo(47.3769, 4);
      expect(res.body.data.lon).toBeCloseTo(8.5417, 4);
    });

    it("still saves the lodging when geocoding fails", async () => {
      jest.spyOn(geo, "resolveCoordinates").mockResolvedValue(null);
      const res = await request(app)
        .post("/api/v1/lodging")
        .set("Cookie", authCookie)
        .send({ name: "Hotel Nowhere", city: "Nowhere" });
      expect(res.status).toBe(201);
      expect(res.body.data.lat).toBeNull();
      expect(res.body.data.lon).toBeNull();
    });

    it("keeps explicit coordinates and does not geocode over them", async () => {
      const spy = jest.spyOn(geo, "resolveCoordinates");
      const res = await request(app)
        .post("/api/v1/lodging")
        .set("Cookie", authCookie)
        .send({ name: "Pinned", city: "Berlin", lat: 1.5, lon: 2.5 });
      expect(res.status).toBe(201);
      expect(res.body.data.lat).toBe(1.5);
      expect(res.body.data.lon).toBe(2.5);
      // resolveCoordinates was called (route always calls it) but its own
      // short-circuit for explicit coords means it resolved to null — the
      // route must not overwrite the caller's coords with that null.
      await expect(spy.mock.results[0].value).resolves.toBeNull();
    });

    it("does not geocode on a PATCH that does not touch the address", async () => {
      const created = await prisma.lodging.create({
        data: { userId, name: "Geocode Untouched Inn", city: "Munich", country: "DE", lat: 48.1, lon: 11.5 },
      });
      const spy = jest.spyOn(geo, "resolveCoordinates");
      const res = await request(app)
        .patch(`/api/v1/lodging/${created.id}`)
        .set("Cookie", authCookie)
        .send({ notes: "Nice place" });
      expect(res.status).toBe(200);
      expect(res.body.data.lat).toBe(48.1);
      expect(res.body.data.lon).toBe(11.5);
      expect(spy).not.toHaveBeenCalled();
    });

    it("re-geocodes on PATCH when the address changes", async () => {
      const created = await prisma.lodging.create({
        data: { userId, name: "Geocode Update Inn", city: "Munich", country: "DE", lat: 48.1, lon: 11.5 },
      });
      jest.spyOn(geo, "resolveCoordinates").mockResolvedValue({ lat: 52.52, lon: 13.405 });
      const res = await request(app)
        .patch(`/api/v1/lodging/${created.id}`)
        .set("Cookie", authCookie)
        .send({ city: "Berlin" });
      expect(res.status).toBe(200);
      expect(res.body.data.lat).toBeCloseTo(52.52, 4);
      expect(res.body.data.lon).toBeCloseTo(13.405, 4);
    });

    it("a failed geocode on PATCH does not wipe existing coordinates", async () => {
      const created = await prisma.lodging.create({
        data: { userId, name: "Geocode Fail Inn", city: "Munich", country: "DE", lat: 48.1, lon: 11.5 },
      });
      jest.spyOn(geo, "resolveCoordinates").mockResolvedValue(null);
      const res = await request(app)
        .patch(`/api/v1/lodging/${created.id}`)
        .set("Cookie", authCookie)
        .send({ city: "Nowhereville" });
      expect(res.status).toBe(200);
      // resolveCoordinates returned null ("leave untouched"), so the
      // PREVIOUSLY GOOD coordinates must survive — never nulled out.
      expect(res.body.data.lat).toBe(48.1);
      expect(res.body.data.lon).toBe(11.5);
    });
  });

  describe("Lodging CRUD", () => {
    it("creates a lodging with a null overall rating (no stays yet)", async () => {
      const res = await request(app)
        .post("/api/v1/lodging")
        .set("Cookie", authCookie)
        .send({ name: "Boutique Inn", city: "Paris", country: "FR" });
      expect(res.status).toBe(201);
      expect(res.body.data.userId).toBe(userId);
      expect(res.body.data.overallRating).toBeNull();
    });

    it("sets dataSource='manual' server-side and ignores a client-forged value (finding 1)", async () => {
      const res = await request(app)
        .post("/api/v1/lodging")
        .set("Cookie", authCookie)
        .send({ name: "Forged Source Inn", dataSource: "parser" });
      expect(res.status).toBe(201);
      expect(res.body.data.dataSource).toBe("manual");
    });

    it("does not allow PATCH to change dataSource (finding 1)", async () => {
      const create = await request(app)
        .post("/api/v1/lodging")
        .set("Cookie", authCookie)
        .send({ name: "Immutable Source Inn" });
      expect(create.body.data.dataSource).toBe("manual");

      // dataSource is not a field on updateLodgingSchema at all, so it is
      // stripped before validation; a real field (`name`) rides along so the
      // "at least one field" guard doesn't reject the request outright.
      const res = await request(app)
        .patch(`/api/v1/lodging/${create.body.data.id}`)
        .set("Cookie", authCookie)
        .send({ name: "Renamed Inn", dataSource: "enriched" });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Renamed Inn");
      expect(res.body.data.dataSource).toBe("manual");
    });

    it("rejects an invalid payload (missing name)", async () => {
      const res = await request(app).post("/api/v1/lodging").set("Cookie", authCookie).send({});
      expect(res.status).toBe(400);
    });

    it("derives the overall rating as the mean of rated stays, ignores unrated, handles a same-day (0-night) stay", async () => {
      const lodging = await prisma.lodging.create({ data: { userId, name: "Rated Hotel" } });
      await prisma.lodgingStay.createMany({
        data: [
          {
            lodgingId: lodging.id,
            userId,
            checkIn: new Date("2024-01-01T00:00:00.000Z"),
            checkOut: new Date("2024-01-02T00:00:00.000Z"),
            ratingOverall: 4,
          },
          {
            lodgingId: lodging.id,
            userId,
            checkIn: new Date("2024-02-01T00:00:00.000Z"),
            checkOut: new Date("2024-02-03T00:00:00.000Z"),
            ratingOverall: 5,
          },
          {
            lodgingId: lodging.id,
            userId,
            checkIn: new Date("2024-03-01T00:00:00.000Z"),
            checkOut: new Date("2024-03-01T00:00:00.000Z"),
          },
        ],
      });
      const res = await request(app)
        .get(`/api/v1/lodging/${lodging.id}`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.overallRating).toBe(4.5);
      expect(res.body.data.stayCount).toBe(3);
      expect(res.body.data.nights).toBe(3); // 1 + 2 + 0
    });

    it("updates a lodging", async () => {
      const res = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}`)
        .set("Cookie", authCookie)
        .send({ stars: 4 });
      expect(res.status).toBe(200);
      expect(res.body.data.stars).toBe(4);
    });

    it("deletes a lodging and cascades its stays", async () => {
      const lodging = await prisma.lodging.create({ data: { userId, name: "To Delete" } });
      const stay = await prisma.lodgingStay.create({
        data: {
          lodgingId: lodging.id,
          userId,
          checkIn: new Date("2024-01-01T00:00:00.000Z"),
          checkOut: new Date("2024-01-02T00:00:00.000Z"),
        },
      });
      const res = await request(app).delete(`/api/v1/lodging/${lodging.id}`).set("Cookie", authCookie);
      expect(res.status).toBe(204);
      const goneStay = await prisma.lodgingStay.findUnique({ where: { id: stay.id } });
      expect(goneStay).toBeNull();
    });

    it("lists only the authenticated user's lodgings", async () => {
      const res = await request(app).get("/api/v1/lodging").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      for (const l of res.body.data) {
        expect(l.userId).toBe(userId);
      }
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/lodging");
      expect(res.status).toBe(401);
    });
  });

  describe("PATCH — previously-set optional fields can be cleared with an explicit null (finding 4)", () => {
    it("clears a lodging's address/city/country/notes", async () => {
      const created = await prisma.lodging.create({
        data: {
          userId,
          name: "Clearable Fields Hotel",
          address: "Bahnhofstrasse 1",
          city: "Zürich",
          country: "CH",
          notes: "Some notes",
        },
      });
      const res = await request(app)
        .patch(`/api/v1/lodging/${created.id}`)
        .set("Cookie", authCookie)
        .send({ address: null, city: null, country: null, notes: null });

      expect(res.status).toBe(200);
      expect(res.body.data.address).toBeNull();
      expect(res.body.data.city).toBeNull();
      expect(res.body.data.country).toBeNull();
      expect(res.body.data.notes).toBeNull();

      const reread = await request(app)
        .get(`/api/v1/lodging/${created.id}`)
        .set("Cookie", authCookie);
      expect(reread.body.data.address).toBeNull();
      expect(reread.body.data.city).toBeNull();
      expect(reread.body.data.country).toBeNull();
      expect(reread.body.data.notes).toBeNull();
    });

    it("clears a stay's roomNumber/roomCategory/bookingReference/pricePerNight/receiptUrl/ratings/notes", async () => {
      const l = await prisma.lodging.create({ data: { userId, name: "Clearable Stay Hotel" } });
      const stay = await prisma.lodgingStay.create({
        data: {
          lodgingId: l.id,
          userId,
          checkIn: new Date("2025-03-01T00:00:00.000Z"),
          checkOut: new Date("2025-03-02T00:00:00.000Z"),
          roomNumber: "204",
          roomCategory: "Deluxe",
          bookingReference: "BK-123",
          pricePerNight: 150,
          receiptUrl: "/api/v1/uploads/receipts/abc.pdf",
          ratingRoom: 4,
          ratingBreakfast: 3,
          ratingService: 5,
          ratingOverall: 4,
          notes: "Nice stay",
        },
      });

      const res = await request(app)
        .patch(`/api/v1/lodging/${l.id}/stays/${stay.id}`)
        .set("Cookie", authCookie)
        .send({
          roomNumber: null,
          roomCategory: null,
          bookingReference: null,
          pricePerNight: null,
          receiptUrl: null,
          ratingRoom: null,
          ratingBreakfast: null,
          ratingService: null,
          ratingOverall: null,
          notes: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.roomNumber).toBeNull();
      expect(res.body.data.roomCategory).toBeNull();
      expect(res.body.data.bookingReference).toBeNull();
      expect(res.body.data.pricePerNight).toBeNull();
      expect(res.body.data.receiptUrl).toBeNull();
      expect(res.body.data.ratingRoom).toBeNull();
      expect(res.body.data.ratingBreakfast).toBeNull();
      expect(res.body.data.ratingService).toBeNull();
      expect(res.body.data.ratingOverall).toBeNull();
      expect(res.body.data.notes).toBeNull();

      const reread = await prisma.lodgingStay.findUnique({ where: { id: stay.id } });
      expect(reread?.roomNumber).toBeNull();
      expect(reread?.notes).toBeNull();
    });
  });

  describe("totalSpendBase never mixes fxBaseCurrency snapshots (finding 2)", () => {
    it("only sums stays whose FX snapshot matches the CURRENT base currency", async () => {
      const l = await prisma.lodging.create({ data: { userId, name: "Currency Switch Hotel" } });
      await prisma.lodgingStay.createMany({
        data: [
          {
            lodgingId: l.id,
            userId,
            checkIn: new Date("2023-01-01T00:00:00.000Z"),
            checkOut: new Date("2023-01-02T00:00:00.000Z"),
            totalPrice: 100,
            currency: "EUR",
            totalPriceBase: 100,
            fxBaseCurrency: "EUR", // snapshotted while the user's base was EUR
          },
          {
            lodgingId: l.id,
            userId,
            checkIn: new Date("2024-01-01T00:00:00.000Z"),
            checkOut: new Date("2024-01-02T00:00:00.000Z"),
            totalPrice: 200,
            currency: "EUR",
            totalPriceBase: 200,
            fxBaseCurrency: "EUR", // still current base = EUR for this test user
          },
        ],
      });

      const res = await request(app).get(`/api/v1/lodging/${l.id}`).set("Cookie", authCookie);
      expect(res.status).toBe(200);
      // This test user's UserSettings.baseCurrency is EUR (set in the outer
      // beforeAll) — both stays match, so the honest total is their sum.
      expect(res.body.data.totalSpendBase).toBe(300);
      expect(res.body.data.totalSpendBaseByCurrency).toEqual({ EUR: 300 });
    });

    it("excludes a stay snapshotted under a DIFFERENT base currency from totalSpendBase but reports it separately", async () => {
      const l = await prisma.lodging.create({ data: { userId, name: "Stale Snapshot Hotel" } });
      await prisma.lodgingStay.createMany({
        data: [
          {
            lodgingId: l.id,
            userId,
            checkIn: new Date("2022-01-01T00:00:00.000Z"),
            checkOut: new Date("2022-01-02T00:00:00.000Z"),
            totalPrice: 400,
            currency: "CHF",
            totalPriceBase: 424,
            // Snapshotted under a base currency the user no longer uses —
            // must NOT be added into a "EUR" total.
            fxBaseCurrency: "CHF",
          },
          {
            lodgingId: l.id,
            userId,
            checkIn: new Date("2024-01-01T00:00:00.000Z"),
            checkOut: new Date("2024-01-02T00:00:00.000Z"),
            totalPrice: 100,
            currency: "EUR",
            totalPriceBase: 100,
            fxBaseCurrency: "EUR",
          },
        ],
      });

      const res = await request(app).get(`/api/v1/lodging/${l.id}`).set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.totalSpendBase).toBe(100); // ONLY the EUR-snapshotted stay
      expect(res.body.data.totalSpendBaseByCurrency).toEqual({ CHF: 424, EUR: 100 });
    });
  });

  describe("GET /api/v1/lodging — sort applies to the full result set, then paginates (finding 2)", () => {
    const countryTag = "SortRegressionTest";
    // Creation order (and thus DB createdAt-desc order) is deliberately
    // SCRAMBLED relative to nights, so a "sort the already-truncated page"
    // bug produces a different page-2 than a correct "sort then paginate".
    // Created in this order: 3,1,5,2,4 nights -> createdAt desc = [4,2,5,1,3].
    const nightsInCreationOrder = [3, 1, 5, 2, 4];
    let idsInCreationOrder: string[];

    beforeAll(async () => {
      idsInCreationOrder = [];
      for (const n of nightsInCreationOrder) {
        const l = await prisma.lodging.create({
          data: { userId, name: `SortHotel ${n}`, country: countryTag },
        });
        await prisma.lodgingStay.create({
          data: {
            lodgingId: l.id,
            userId,
            checkIn: new Date("2024-01-01T00:00:00.000Z"),
            checkOut: new Date(new Date("2024-01-01T00:00:00.000Z").getTime() + n * 86400000),
          },
        });
        idsInCreationOrder.push(l.id);
      }
    });

    it("returns the globally-correct page 2 sorted by nights, not a re-sort of the truncated page", async () => {
      // Correct answer: sort ALL 5 rows by nights desc (5,4,3,2,1), then
      // slice offset=2/limit=2 -> the two middle-nights rows (3 and 2).
      const idByNights = new Map(
        nightsInCreationOrder.map((n, i) => [n, idsInCreationOrder[i]]),
      );
      const expectedGlobalOrder = [5, 4, 3, 2, 1].map((n) => idByNights.get(n));
      const res = await request(app)
        .get(`/api/v1/lodging?country=${countryTag}&sort=nights&limit=2&offset=2`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.map((l: { id: string }) => l.id)).toEqual(
        expectedGlobalOrder.slice(2, 4),
      );
    });
  });

  describe("GET /api/v1/lodging — pagination metadata (finding: silent truncation)", () => {
    const countryTag = "PaginationMetaTest";

    beforeAll(async () => {
      for (let i = 0; i < 3; i++) {
        await prisma.lodging.create({
          data: { userId, name: `PageMetaHotel ${i}`, country: countryTag },
        });
      }
    });

    it("reports meta.total for the full filtered set even when limit truncates data", async () => {
      const res = await request(app)
        .get(`/api/v1/lodging?country=${countryTag}&limit=2`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toEqual({ total: 3, limit: 2, offset: 0 });
    });

    it("lets a client walk to the next page via offset", async () => {
      const res = await request(app)
        .get(`/api/v1/lodging?country=${countryTag}&limit=2&offset=2`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toEqual({ total: 3, limit: 2, offset: 2 });
    });
  });

  describe("Ownership isolation (no cross-user data leak)", () => {
    it("404s reading another user's lodging", async () => {
      const foreign = await prisma.lodging.create({ data: { userId: otherUserId, name: "Foreign Hotel" } });
      const res = await request(app).get(`/api/v1/lodging/${foreign.id}`).set("Cookie", authCookie);
      expect(res.status).toBe(404);
    });

    it("404s updating another user's lodging", async () => {
      const foreign = await prisma.lodging.create({ data: { userId: otherUserId, name: "Foreign Hotel 2" } });
      const res = await request(app)
        .patch(`/api/v1/lodging/${foreign.id}`)
        .set("Cookie", authCookie)
        .send({ name: "Hacked" });
      expect(res.status).toBe(404);
    });

    it("404s deleting another user's lodging (row survives)", async () => {
      const foreign = await prisma.lodging.create({ data: { userId: otherUserId, name: "Foreign Hotel 3" } });
      const res = await request(app).delete(`/api/v1/lodging/${foreign.id}`).set("Cookie", authCookie);
      expect(res.status).toBe(404);
      const still = await prisma.lodging.findUnique({ where: { id: foreign.id } });
      expect(still).not.toBeNull();
    });

    it("404s creating a stay under another user's lodging", async () => {
      const foreign = await prisma.lodging.create({ data: { userId: otherUserId, name: "Foreign Hotel 4" } });
      const res = await request(app)
        .post(`/api/v1/lodging/${foreign.id}/stays`)
        .set("Cookie", authCookie)
        .send({ checkIn: "2024-09-01T00:00:00.000Z", checkOut: "2024-09-02T00:00:00.000Z" });
      expect(res.status).toBe(404);
    });

    it("404s patching a stay belonging to another user's lodging (row untouched)", async () => {
      const foreign = await prisma.lodging.create({ data: { userId: otherUserId, name: "Foreign Hotel 5" } });
      const foreignStay = await prisma.lodgingStay.create({
        data: {
          lodgingId: foreign.id,
          userId: otherUserId,
          checkIn: new Date("2024-09-01T00:00:00.000Z"),
          checkOut: new Date("2024-09-02T00:00:00.000Z"),
        },
      });
      const res = await request(app)
        .patch(`/api/v1/lodging/${foreign.id}/stays/${foreignStay.id}`)
        .set("Cookie", authCookie)
        .send({ notes: "x" });
      expect(res.status).toBe(404);
      const still = await prisma.lodgingStay.findUnique({ where: { id: foreignStay.id } });
      expect(still?.notes).toBeNull();
    });

    it("404s deleting a stay belonging to another user's lodging (row survives)", async () => {
      const foreign = await prisma.lodging.create({ data: { userId: otherUserId, name: "Foreign Hotel 6" } });
      const foreignStay = await prisma.lodgingStay.create({
        data: {
          lodgingId: foreign.id,
          userId: otherUserId,
          checkIn: new Date("2024-09-01T00:00:00.000Z"),
          checkOut: new Date("2024-09-02T00:00:00.000Z"),
        },
      });
      const res = await request(app)
        .delete(`/api/v1/lodging/${foreign.id}/stays/${foreignStay.id}`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(404);
      const still = await prisma.lodgingStay.findUnique({ where: { id: foreignStay.id } });
      expect(still).not.toBeNull();
    });
  });

  describe("POST/PATCH /api/v1/lodging/:id/stays — membership opt-out", () => {
    let optOutLodgingId: string;

    beforeAll(async () => {
      const l = await prisma.lodging.create({ data: { userId, name: "Opt Out Hotel" } });
      optOutLodgingId = l.id;
    });

    it("defaults to false and round-trips true", async () => {
      const created = await request(app)
        .post(`/api/v1/lodging/${optOutLodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({ checkIn: "2026-02-01T15:00:00.000Z", checkOut: "2026-02-02T11:00:00.000Z" });
      expect(created.status).toBe(201);
      expect(created.body.data.membershipOptOut).toBe(false);

      const patched = await request(app)
        .patch(`/api/v1/lodging/${optOutLodgingId}/stays/${created.body.data.id}`)
        .set("Cookie", authCookie)
        .send({ membershipOptOut: true });
      expect(patched.status).toBe(200);
      expect(patched.body.data.membershipOptOut).toBe(true);
    });

    it("can be turned back off, and does not clear the override on its own", async () => {
      const created = await request(app)
        .post(`/api/v1/lodging/${optOutLodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2026-02-03T15:00:00.000Z",
          checkOut: "2026-02-04T11:00:00.000Z",
          membershipOptOut: true,
        });
      const res = await request(app)
        .patch(`/api/v1/lodging/${optOutLodgingId}/stays/${created.body.data.id}`)
        .set("Cookie", authCookie)
        .send({ membershipOptOut: false });
      expect(res.status).toBe(200);
      expect(res.body.data.membershipOptOut).toBe(false);
    });
  });
});
