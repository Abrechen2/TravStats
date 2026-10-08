import request from "supertest";

// The real module, with only the snapshot lookup replaced: the test can then
// say WHICH DATE the route asked the rate for — a stored `fxRateDate` the real
// resolver might fill from anywhere would prove nothing about the route.
jest.mock("../../services/fx/snapshot", () => ({
  ...jest.requireActual("../../services/fx/snapshot"),
  fxColumnsFor: jest.fn(),
}));

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { busCreationLimiter } from "../../middleware/rateLimit";
import { fxColumnsFor } from "../../services/fx/snapshot";

const fxMock = fxColumnsFor as jest.MockedFunction<typeof fxColumnsFor>;

const SEOUL = { name: "Seoul Express Bus Terminal", lat: 37.5048, lon: 127.0046, country: "KR" };
const SOKCHO = { name: "Sokcho Express Bus Terminal", lat: 38.1911, lon: 128.5918, country: "KR" };

/** Rail's rule, which bus follows: FX is recomputed only when price, currency or the departure instant changed. */
describe("Bus rides API — the FX snapshot", () => {
  let cookie: string;
  let userId: string;

  const base = {
    departureStation: SEOUL,
    arrivalStation: SOKCHO,
    departureLocal: "2026-09-20T09:00",
    arrivalLocal: "2026-09-20T11:20",
    price: 23000,
    currency: "KRW",
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "busfx" } });
    const user = await prisma.user.create({
      data: { username: "busfx", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(() => {
    fxMock.mockReset();
    fxMock.mockImplementation(async (input) => ({
      priceBase: 20,
      fxRate: 0.00064,
      fxRateDate: input.date as Date,
      fxBaseCurrency: "EUR",
      fxSource: "test",
    }));
  });

  afterEach(async () => {
    await prisma.busJourney.deleteMany({ where: { userId } });
    await busCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("dates the rate by the departure instant and stores what the snapshot returned", async () => {
    const res = await request(app).post("/api/v1/bus").set("Cookie", cookie).send(base);
    expect(res.status).toBe(201);
    expect(fxMock).toHaveBeenCalledTimes(1);
    const [input] = fxMock.mock.calls[0];
    expect(input).toMatchObject({ amount: 23000, currency: "KRW" });
    // 09:00 in Seoul is 00:00 UTC — the stored instant, not the wall clock read as UTC.
    expect((input.date as Date).toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(res.body.data.priceBase).toBe(20);
    expect(res.body.data.fxRate).toBe(0.00064);
    expect(res.body.data.fxRateDate).toBe("2026-09-20T00:00:00.000Z");
    expect(res.body.data.fxBaseCurrency).toBe("EUR");
  });

  it("does not ask for a rate again when only the seat changes, and does when the price does", async () => {
    const created = await request(app).post("/api/v1/bus").set("Cookie", cookie).send(base);
    const id = created.body.data.id;
    expect(fxMock).toHaveBeenCalledTimes(1);

    const seat = await request(app)
      .patch(`/api/v1/bus/${id}`)
      .set("Cookie", cookie)
      .send({ seat: "12A" });
    expect(seat.status).toBe(200);
    expect(fxMock).toHaveBeenCalledTimes(1);
    expect(seat.body.data.priceBase).toBe(20);

    const price = await request(app)
      .patch(`/api/v1/bus/${id}`)
      .set("Cookie", cookie)
      .send({ price: 25000 });
    expect(price.status).toBe(200);
    expect(fxMock).toHaveBeenCalledTimes(2);
    expect(fxMock.mock.calls[1][0]).toMatchObject({ amount: 25000, currency: "KRW" });
  });
});
