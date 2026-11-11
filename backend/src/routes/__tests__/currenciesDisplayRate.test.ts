import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { resolveRate } from "../../services/fx/resolver";

jest.mock("../../services/fx/resolver", () => ({
  ...jest.requireActual("../../services/fx/resolver"),
  resolveRate: jest.fn(),
}));

/** GET /currencies/display-rate — base → display, so totals can be shown converted. */
describe("display currency rate", () => {
  const username = `displayrate_${Date.now()}`;
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });
  beforeEach(() => jest.mocked(resolveRate).mockReset());
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  const setCurrencies = (baseCurrency: string, displayCurrency: string | null) =>
    prisma.userSettings.upsert({
      where: { userId },
      create: { userId, data: {}, baseCurrency, displayCurrency },
      update: { baseCurrency, displayCurrency },
    });
  const get = () => request(app).get("/api/v1/currencies/display-rate").set("Cookie", cookie);

  it("answers rate 1 without asking the FX chain when display equals base", async () => {
    await setCurrencies("EUR", null);
    const res = await get().expect(200);
    expect(res.body.data).toMatchObject({ base: "EUR", display: "EUR", rate: 1 });
    expect(resolveRate).not.toHaveBeenCalled();
  });

  it("carries the chain's rate for a display currency that differs from the base", async () => {
    await setCurrencies("EUR", "USD");
    jest.mocked(resolveRate).mockResolvedValue({ rate: 1.1, source: "ecb" } as never);
    const res = await get().expect(200);
    expect(res.body.data).toMatchObject({ base: "EUR", display: "USD", rate: 1.1, source: "ecb" });
    expect(resolveRate).toHaveBeenCalledWith(
      "EUR",
      "USD",
      expect.stringMatching(/^\d{4}-\d\d-\d\d$/)
    );
  });

  it("answers rate null when no rate exists, never a made-up one", async () => {
    await setCurrencies("EUR", "JPY");
    jest.mocked(resolveRate).mockResolvedValue(null);
    const res = await get().expect(200);
    expect(res.body.data).toMatchObject({ display: "JPY", rate: null, rateDate: null });
  });
});
