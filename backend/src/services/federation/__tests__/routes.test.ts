import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { getInstanceSettings } from "../../instanceSettingsService";
import { errorHandler } from "../../../middleware/errorHandler";
import comparison from "../../../routes/encryptedShare";

jest.mock("../../../middleware/auth", () => ({
  ...jest.requireActual("../../../middleware/auth"),
  authenticate: (
    req: express.Request & { userId?: string; apiToken?: unknown },
    _res: express.Response,
    next: express.NextFunction
  ) => {
    req.userId = req.header("x-test-user");
    if (req.header("x-test-pat")) req.apiToken = { id: "test", scope: "write" };
    next();
  },
}));
jest.mock("../../instanceSettingsService", () => ({ getInstanceSettings: jest.fn() }));
const app = express();
app.use(express.json());
app.use("/api/v1/encrypted-share", comparison);
app.use(errorHandler);
let userId: string;
beforeAll(async () => {
  const user = await prisma.user.create({
    data: { username: `comparison-route-${randomUUID()}`, passwordHash: "test-only" },
  });
  userId = user.id;
});
beforeEach(() => {
  jest.mocked(getInstanceSettings).mockResolvedValue({ betaFeaturesEnabled: true } as never);
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});
it("rejects PATs even when the browser feature is enabled", async () => {
  const response = await request(app)
    .get("/api/v1/encrypted-share/links")
    .set("x-test-user", userId)
    .set("x-test-pat", "yes");
  expect(response.status).toBe(403);
});
it("fails closed while the instance beta switch is disabled", async () => {
  jest.mocked(getInstanceSettings).mockResolvedValue({ betaFeaturesEnabled: false } as never);
  expect(
    (await request(app).get("/api/v1/encrypted-share/links").set("x-test-user", userId)).status
  ).toBe(403);
});
it("does not allow an ordinary account to admit peers", async () => {
  expect(
    (await request(app).get("/api/v1/encrypted-share/peers").set("x-test-user", userId)).status
  ).toBe(403);
});
it("returns only this user's links and refuses oversized or unknown grant fields", async () => {
  const res = await request(app).get("/api/v1/encrypted-share/links").set("x-test-user", userId);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, data: [] });
  const bad = await request(app)
    .post(`/api/v1/encrypted-share/links/${randomUUID()}/grant`)
    .set("x-test-user", userId)
    .send({ audience: "", scope: { all: true } });
  expect(bad.status).toBe(400);
});

it("has no plaintext comparison fallback and applies the same cookie gate to encrypted routes", async () => {
  expect(
    (
      await request(app)
        .post(`/api/v1/encrypted-share/links/${randomUUID()}/read`)
        .set("x-test-user", userId)
        .send({ year: null })
    ).status
  ).toBe(410);
  expect(
    (
      await request(app)
        .post("/api/v1/encrypted-share/circles/read")
        .set("x-test-user", userId)
        .send({})
    ).status
  ).toBe(410);
  expect(
    (
      await request(app)
        .get("/api/v1/encrypted-share/sealed/devices")
        .set("x-test-user", userId)
        .set("x-test-pat", "yes")
    ).status
  ).toBe(403);
});

it("lists only the owner's publication metadata without ciphertext or sender keys", async () => {
  const other = await prisma.user.create({
    data: { username: `comparison-other-${randomUUID()}`, passwordHash: "test-only" },
  });
  const make = async (owner: string) =>
    prisma.comparisonPublication.create({
      data: {
        id: randomUUID(),
        userId: owner,
        linkId: (
          await prisma.comparisonLink.create({
            data: { userId: owner, channel: randomUUID(), origin: "local", label: "friend" },
          })
        ).id,
        audience: "",
        revision: 1,
        sender: "must-not-be-in-status",
        context: { private: "not-in-status" },
        expiresAt: new Date(Date.now() + 60000),
      },
    });
  const own = await make(userId);
  try {
    const foreign = await make(other.id);
    const response = await request(app)
      .get("/api/v1/encrypted-share/sealed/publications")
      .set("x-test-user", userId);
    expect(response.status).toBe(200);
    expect(response.body.data.map((p: { id: string }) => p.id)).toEqual([own.id]);
    expect(JSON.stringify(response.body)).not.toMatch(
      new RegExp(`${foreign.id}|must-not-be-in-status|not-in-status`)
    );
    expect(response.body.data[0]).not.toHaveProperty("manifest");
    expect(
      (
        await request(app)
          .get("/api/v1/encrypted-share/sealed/publications")
          .set("x-test-user", userId)
          .set("x-test-pat", "yes")
      ).status
    ).toBe(403);
  } finally {
    await prisma.comparisonPublication.delete({ where: { id: own.id } });
    await prisma.user.delete({ where: { id: other.id } });
  }
});

it("previews exactly the fields a grant publishes, from the same inventory", async () => {
  // The consent preview once read its own field list while publication read
  // fieldInventory.json, so the friend received fields the owner never saw.
  await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, enabledDomains: ["flight"], data: {} },
    update: { enabledDomains: ["flight"] },
  });
  await prisma.flight.create({
    data: {
      userId,
      flightNumber: "LH400",
      operatingAirline: "Lufthansa CityLine",
      depLat: 50.03,
      depLon: 8.57,
      arrLat: 40.64,
      arrLon: -73.78,
      departureTime: new Date("2025-03-01T10:00:00Z"),
      price: 900,
      taxes: 120,
      seatNumber: "12A",
    },
  });
  for (const extra of [
    { costs: false, personal: false },
    { costs: true, personal: true },
  ]) {
    const scope = {
      statistics: false,
      details: true,
      photos: false,
      documents: false,
      domains: ["flight"],
      tripIds: [],
      futureTrips: true,
      year: null,
      precision: "exact",
      expiresAt: null,
      ...extra,
    };
    const preview = await request(app)
      .post("/api/v1/encrypted-share/preview/records")
      .set("x-test-user", userId)
      .send({ scope, domain: "flight" });
    const published = await request(app)
      .post("/api/v1/encrypted-share/sealed/source")
      .set("x-test-user", userId)
      .send(scope);
    expect(preview.status).toBe(200);
    expect(published.status).toBe(200);
    const sent = published.body.data.sections.flights as Array<Record<string, unknown>>;
    expect(sent).toHaveLength(1);
    const shown = preview.body.data.rows[0].fields.map((f: { name: string }) => f.name);
    expect([...shown].sort()).toEqual(Object.keys(sent[0]).sort());
    expect(shown.includes("taxes")).toBe(extra.costs);
    expect(shown.includes("operatingAirline")).toBe(extra.personal);
  }
});
