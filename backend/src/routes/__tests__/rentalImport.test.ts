import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { rentalCreationLimiter } from "../../middleware/rateLimit";

/**
 * Applying reviewed rental documents (spec 2026-10-01-rental-domain-design
 * §4.4, §4.5). The invoice frame is UNMEASURED against a real booking in CI —
 * every value here is invented; the real invoices are measured locally by
 * `scripts/parser-corpus.ts --domain rental`.
 */
describe("POST /api/v1/rentals/import", () => {
  let cookie: string;
  let userId: string;

  const post = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/rentals/import").set("Cookie", cookie).send(body);

  const confirmation = (over: Record<string, unknown> = {}) => ({
    kind: "confirmation",
    input: {
      provider: "Sixt",
      confirmationNumber: "1234567890",
      pickupStation: { name: "Frankfurt Flughafen", iata: "FRA" },
      pickupLocal: "2026-07-06T09:15",
      returnLocal: "2026-07-08T18:45",
      paymentTiming: "pay_at_counter",
      price: 123.45,
      currency: "EUR",
      ...over,
    },
  });

  const invoice = (over: Record<string, unknown> = {}) => ({
    kind: "invoice",
    invoice: {
      provider: "Sixt",
      confirmationNumber: "1234567890",
      agreementNumber: "9876543210",
      invoiceNumber: "1111222233334444",
      odometerOutKm: 10000,
      odometerInKm: 10412,
      distanceKm: 412,
      vehicleDriven: "Opel Corsa",
      actualPickupLocal: "2026-07-06T09:20",
      actualReturnLocal: "2026-07-08T18:10",
      finalAmount: 150.75,
      finalCurrency: "EUR",
      ...over,
    },
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "rentalimport" } });
    const user = await prisma.user.create({
      data: { username: "rentalimport", passwordHash: await hashPassword("password123") },
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

  it("creates a rental from a confirmation, keyed by provider and number", async () => {
    const res = await post(confirmation());
    expect(res.status).toBe(201);
    expect(res.body.meta.outcome).toBe("created");
    expect(res.body.data).toMatchObject({
      externalRef: "rental:sixt:1234567890",
      pickupIata: "FRA",
      userEditedFields: [],
      distanceKm: null,
    });
  });

  it("updates — never duplicates — when the same booking arrives again", async () => {
    await post(confirmation());
    const again = await post(confirmation({ returnLocal: "2026-07-09T10:00" }));
    expect(again.status).toBe(200);
    expect(again.body.meta.outcome).toBe("updated");
    expect(await prisma.rentalBooking.count({ where: { userId } })).toBe(1);
    expect(again.body.data.times.return.local).toBe("2026-07-09T10:00:00");
  });

  it("reads the same mail twice as unchanged — no second row, no rewrite", async () => {
    const first = (await post(confirmation())).body.data;
    const again = await post(confirmation());
    expect(again.body.meta.outcome).toBe("unchanged");
    expect(again.body.data.updatedAt).toBe(first.updatedAt);
    expect(await prisma.rentalBooking.count({ where: { userId } })).toBe(1);
  });

  it("never overwrites a field the user edited by hand", async () => {
    const created = (await post(confirmation())).body.data;
    await request(app)
      .patch(`/api/v1/rentals/${created.id}`)
      .set("Cookie", cookie)
      .send({ price: 99 });
    const again = await post(confirmation({ price: 500 }));
    expect(again.body.data.price).toBe(99);
  });

  it("never replaces a time with a bare day, nor a value with nothing", async () => {
    await post(confirmation());
    const poorer = await post(confirmation({ returnLocal: "2026-07-08", price: null }));
    expect(poorer.body.data.times.return.local).toBe("2026-07-08T18:45:00");
    expect(poorer.body.data.price).toBe(123.45);
  });

  it("cancels the booking a cancellation names — and keeps the row", async () => {
    const created = (await post(confirmation())).body.data;
    const res = await post({
      kind: "cancellation",
      provider: "Sixt",
      confirmationNumber: "1234567890",
    });
    expect(res.body.meta.outcome).toBe("cancelled");
    const row = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe("cancelled");
  });

  it("refuses a cancellation for an unknown booking and creates nothing", async () => {
    const res = await post({
      kind: "cancellation",
      provider: "Sixt",
      confirmationNumber: "5555555555",
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("RENTAL_UNKNOWN_BOOKING");
    expect(await prisma.rentalBooking.count({ where: { userId } })).toBe(0);
  });

  it("refuses an invoice with no matching booking and creates nothing", async () => {
    const res = await post(
      invoice({ confirmationNumber: "5555555555", agreementNumber: null, invoiceNumber: null })
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("RENTAL_UNKNOWN_BOOKING");
    expect(await prisma.rentalBooking.count({ where: { userId } })).toBe(0);
  });

  it("fills km, car, actual times and final amount from a matched invoice", async () => {
    await post(confirmation());
    const res = await post(invoice());
    expect(res.status).toBe(200);
    expect(res.body.meta.outcome).toBe("invoiced");
    expect(res.body.data).toMatchObject({
      distanceKm: 412,
      distanceSource: "invoice",
      odometerOutKm: 10000,
      odometerInKm: 10412,
      vehicleDriven: "Opel Corsa",
      finalAmount: 150.75,
      finalAmountSource: "invoice",
      invoiceNumber: "1111222233334444",
      cost: { amount: 150.75, currency: "EUR", source: "final" },
    });
    expect(res.body.data.times.actualReturn.local).toBe("2026-07-08T18:10:00");
  });

  it("keeps an invoice's return printed without an hour a day, not a midnight", async () => {
    await post(confirmation());
    const res = await post(invoice({ actualPickupLocal: null, actualReturnLocal: "2026-07-08" }));
    expect(res.status).toBe(200);
    expect(res.body.data.times.actualReturn).toMatchObject({
      local: "2026-07-08T00:00:00",
      precision: "day",
    });
  });

  // forgejo#237: each reading of the invoice is taken on its own.
  it("takes only the invoice's parts the review kept, and never the booked price", async () => {
    await post(confirmation());
    const res = await post({
      ...invoice(),
      adopt: { finalAmount: false, vehicleDriven: false, actualTimes: false },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      finalAmount: null,
      finalAmountSource: null,
      vehicleDriven: null,
      distanceKm: 412,
      odometerOutKm: 10000,
      price: 123.45,
      priceSource: "booking",
      // Counted once: the booked price, since the invoice's amount was not taken.
      cost: { amount: 123.45, currency: "EUR", source: "booked" },
    });
    expect(res.body.data.times.actualReturn).toBeNull();
  });

  it("keeps the booked price and its origin beside the invoice's amount, counting only one", async () => {
    await post(confirmation());
    const res = await post(invoice());
    expect(res.body.data).toMatchObject({
      price: 123.45,
      priceSource: "booking",
      finalAmount: 150.75,
      finalAmountSource: "invoice",
      cost: { amount: 150.75, source: "final" },
    });
  });

  it("does not ask about a typed km figure when the review left the invoice's km out", async () => {
    const created = (await post(confirmation())).body.data;
    await request(app)
      .patch(`/api/v1/rentals/${created.id}`)
      .set("Cookie", cookie)
      .send({ distanceKm: 400 });
    const res = await post({ ...invoice(), adopt: { distance: false } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ distanceKm: 400, distanceSource: "user" });
  });

  // Review I4: the form now sends what changed; the origin survives such a save.
  it("keeps the booked price's origin through a save that does not send the price", async () => {
    const created = (await post(confirmation())).body.data;
    const res = await request(app)
      .patch(`/api/v1/rentals/${created.id}`)
      .set("Cookie", cookie)
      .send({ odometerInKm: 12634, notes: "zurück" });
    expect(res.body.data).toMatchObject({ price: 123.45, priceSource: "booking" });
  });

  it("refuses an adopt key it does not know", async () => {
    await post(confirmation());
    const res = await post({ ...invoice(), adopt: { fees: true } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RENTAL_INVALID_INPUT");
  });

  it("matches a later invoice by the agreement number the first one stored", async () => {
    await post(confirmation());
    await post(invoice());
    const second = await post(
      invoice({ confirmationNumber: null, invoiceNumber: "9999", distanceKm: 420 })
    );
    expect(second.status).toBe(200);
  });

  it("keeps a typed km correction until the user chooses the invoice's", async () => {
    const created = (await post(confirmation())).body.data;
    await request(app)
      .patch(`/api/v1/rentals/${created.id}`)
      .set("Cookie", cookie)
      .send({ distanceKm: 400 });
    const conflict = await post(invoice());
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("RENTAL_INVOICE_KM_CONFLICT");
    const kept = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: created.id } });
    expect(kept.distanceKm).toBe(400);
    const chosen = await post({ ...invoice(), replaceUserDistance: true });
    expect(chosen.body.data).toMatchObject({ distanceKm: 412, distanceSource: "invoice" });
  });

  it("leaves km null when an invoice prints none — never 0", async () => {
    await post(confirmation());
    const res = await post(invoice({ distanceKm: null, odometerOutKm: null, odometerInKm: null }));
    expect(res.body.data.distanceKm).toBeNull();
  });
});
