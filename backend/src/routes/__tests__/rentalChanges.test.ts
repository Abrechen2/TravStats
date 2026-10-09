import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { rentalCreationLimiter } from "../../middleware/rateLimit";

/**
 * Owner ruling (fix round 2): the server records a field as edited only when
 * the sent value DIFFERS from the stored one. A form or the Companion re-sends
 * the whole rental; a value re-sent unchanged keeps its source — the booked
 * price stays the booking's, an invoice's km and amount stay the invoice's.
 * Every value is invented.
 */
describe("Rental writes record only what changed", () => {
  let cookie: string;
  let userId: string;

  const post = (path: string, body: Record<string, unknown>) =>
    request(app).post(`/api/v1/rentals${path}`).set("Cookie", cookie).send(body);
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/rentals/${id}`).set("Cookie", cookie).send(body);

  const confirmation = {
    kind: "confirmation",
    input: {
      provider: "Sixt",
      confirmationNumber: "1234567890",
      pickupStation: { name: "Frankfurt Flughafen", iata: "FRA" },
      pickupLocal: "2025-07-06T09:15",
      returnLocal: "2025-07-08T18:45",
      price: 123.45,
      currency: "EUR",
      vehicleExample: "VW Golf",
    },
  };
  const invoice = {
    kind: "invoice",
    invoice: {
      provider: "Sixt",
      confirmationNumber: "1234567890",
      agreementNumber: null,
      invoiceNumber: "INV-1",
      odometerOutKm: 10000,
      odometerInKm: 10412,
      distanceKm: 412,
      vehicleDriven: "Opel Corsa",
      actualPickupLocal: "2025-07-06T09:20",
      actualReturnLocal: "2025-07-08T18:10",
      finalAmount: 150.75,
      finalCurrency: "EUR",
    },
  };

  /** What a full-form save sends back for an untouched rental. */
  const resend = (r: Record<string, unknown>) => ({
    provider: r.provider,
    confirmationNumber: r.confirmationNumber,
    pickupStation: { name: r.pickupStationName, airportId: r.pickupAirportId },
    pickupLocal: (r.times as { pickup: { local: string } }).pickup.local.slice(0, 16),
    returnLocal: (r.times as { return: { local: string } }).return.local.slice(0, 16),
    price: r.price,
    currency: r.currency,
    vehicleExample: r.vehicleExample,
    vehicleDriven: r.vehicleDriven,
    distanceKm: r.distanceKm,
    odometerOutKm: r.odometerOutKm,
    odometerInKm: r.odometerInKm,
    finalAmount: r.finalAmount,
    finalCurrency: r.finalCurrency,
    actualPickupLocal:
      (r.times as { actualPickup: { local: string } | null }).actualPickup?.local.slice(0, 16) ??
      null,
    actualReturnLocal:
      (r.times as { actualReturn: { local: string } | null }).actualReturn?.local.slice(0, 16) ??
      null,
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "rentalchanges" } });
    const user = await prisma.user.create({
      data: { username: "rentalchanges", passwordHash: await hashPassword("password123") },
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

  it("keeps the booked price the booking's when it is re-sent unchanged", async () => {
    const created = (await post("/import", confirmation)).body.data;
    const res = await patch(created.id, { price: 123.45, currency: "EUR", odometerInKm: 10500 });
    expect(res.status).toBe(200);
    expect(res.body.data.priceSource).toBe("booking");
    expect(res.body.data.userEditedFields).toEqual(["odometerInKm"]);
  });

  it("turns the booked price into one typed by hand once it changes", async () => {
    const created = (await post("/import", confirmation)).body.data;
    const res = await patch(created.id, { price: 130, currency: "EUR" });
    expect(res.body.data.priceSource).toBe("user");
    expect(res.body.data.userEditedFields).toEqual(["price"]);
  });

  it("keeps an invoice's km, amount and car the invoice's through an unchanged full-form save", async () => {
    await post("/import", confirmation);
    const invoiced = (await post("/import", invoice)).body.data;
    const res = await patch(invoiced.id, { ...resend(invoiced), notes: "zurück" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      distanceKm: 412,
      distanceSource: "invoice",
      finalAmount: 150.75,
      finalAmountSource: "invoice",
      priceSource: "booking",
      vehicleDriven: "Opel Corsa",
    });
    expect(res.body.data.userEditedFields).toEqual(["notes"]);
  });

  it("labels a changed km figure and final amount as corrections", async () => {
    await post("/import", confirmation);
    const invoiced = (await post("/import", invoice)).body.data;
    const res = await patch(invoiced.id, { distanceKm: 420, finalAmount: 160 });
    expect(res.body.data).toMatchObject({ distanceSource: "user", finalAmountSource: "user" });
    expect(res.body.data.userEditedFields).toEqual(["distanceKm", "finalAmount"]);
  });

  it("records a clock only when the instant it names changes", async () => {
    const created = (await post("/import", confirmation)).body.data;
    const same = await patch(created.id, { pickupLocal: "2025-07-06T09:15" });
    expect(same.body.data.userEditedFields).toEqual([]);
    const moved = await patch(created.id, { pickupLocal: "2025-07-06T10:15" });
    expect(moved.body.data.userEditedFields).toEqual(["pickupLocal"]);
  });

  it("does not let an unchanged re-sent legacy pair block a save", async () => {
    const created = (await post("/import", confirmation)).body.data;
    // A pre-branch pair: actual pickup 09:20, actual return the day's midnight.
    await prisma.rentalBooking.update({
      where: { id: created.id },
      data: {
        actualPickupTime: new Date("2025-07-06T07:20:00Z"),
        actualPickupPrecision: "minute",
        actualReturnTime: new Date("2025-07-05T22:00:00Z"),
        actualReturnPrecision: "minute",
      },
    });
    const fresh = (await request(app).get(`/api/v1/rentals/${created.id}`).set("Cookie", cookie))
      .body.data;
    const res = await patch(created.id, { ...resend(fresh), notes: "Schlüssel abgegeben" });
    expect(res.status).toBe(200);
  });

  // Re-review, fix round 3: an unchanged re-send derives nothing new — except
  // a snapshot that never succeeded, which any save takes again.
  it("retries a missing FX snapshot on a save that does not touch the price", async () => {
    const created = (await post("/import", confirmation)).body.data;
    await prisma.rentalBooking.update({
      where: { id: created.id },
      data: {
        priceBase: null,
        fxRate: null,
        fxRateDate: null,
        fxBaseCurrency: null,
        fxSource: null,
        finalAmount: 150.75,
        finalCurrency: "EUR",
        finalAmountSource: "invoice",
        finalAmountBase: null,
      },
    });
    const res = await patch(created.id, { price: 123.45, currency: "EUR", notes: "x" });
    expect(res.status).toBe(200);
    const row = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.priceBase).toBe(123.45);
    expect(row.finalAmountBase).toBe(150.75);
    expect(row.finalAmountSource).toBe("invoice");
    expect(res.body.data.priceSource).toBe("booking");
    expect(res.body.data.userEditedFields).toEqual(["notes"]);
  });

  it("does not re-take a snapshot that exists when nothing it depends on changed", async () => {
    const created = (await post("/import", confirmation)).body.data;
    await prisma.rentalBooking.update({
      where: { id: created.id },
      data: { fxSource: "kept-marker" },
    });
    await patch(created.id, { price: 123.45, notes: "y" });
    const row = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.fxSource).toBe("kept-marker");
  });
});
