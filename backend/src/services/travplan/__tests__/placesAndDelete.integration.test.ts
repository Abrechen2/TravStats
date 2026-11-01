import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { JWT_SECRET } from "../../../utils/jwtSecret";
import travplanRouter from "../../../routes/travplan";
import { errorHandler, AppError } from "../../../middleware/errorHandler";

jest.mock("../availability", () => ({
  travPlanOffered: async () => true,
  assertTravPlanOffered: async () => undefined,
  travPlanUserEnabled: async () => true,
  assertTravPlanForUser: async () => undefined,
}));
const mockFind = jest.fn();
jest.mock("../locations", () => ({ findLocations: (...a: unknown[]) => mockFind(...a) }));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1", travplanRouter);
app.use(errorHandler);
let owner: string, stranger: string;
const cookie = (id: string) => "auth_token=" + jwt.sign({ userId: id, epoch: 0 }, JWT_SECRET);
const as = (id: string) => ({
  get: (u: string) =>
    request(app)
      .get("/api/v1" + u)
      .set("Cookie", cookie(id)),
  post: (u: string, b: object) =>
    request(app)
      .post("/api/v1" + u)
      .set("Cookie", cookie(id))
      .send(b),
  del: (u: string) =>
    request(app)
      .delete("/api/v1" + u)
      .set("Cookie", cookie(id)),
});
const unique = "Zzyzx" + randomUUID().slice(0, 6);
let portId: number;
beforeAll(async () => {
  const mk = (n: string) =>
    prisma.user.create({ data: { username: n + randomUUID(), passwordHash: "x" } });
  owner = (await mk("places-")).id;
  stranger = (await mk("stranger-")).id;
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
  portId = (
    await prisma.port.create({
      data: {
        name: unique + " Harbour",
        country: "Germany",
        lat: 54.1,
        lon: 12.1,
        timezone: "Europe/Berlin",
      },
    })
  ).id;
  await prisma.place.create({
    data: { userId: owner, name: unique + " Bay", lat: 50, lon: 8, country: "Germany" },
  });
});
afterAll(async () => {
  await prisma.port.delete({ where: { id: portId } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await prisma.$disconnect();
});

describe("GET /travplan/places", () => {
  it("offers the account's places, ports and geocoder hits, each with coordinates, country and zone", async () => {
    mockFind.mockResolvedValueOnce([
      {
        id: 7,
        name: unique + " Town",
        admin1: "Bavaria",
        country: "Germany",
        latitude: 48.1,
        longitude: 11.5,
        timezone: "Europe/Berlin",
      },
    ]);
    const res = await as(owner).get("/travplan/places?q=" + unique);
    expect(res.status).toBe(200);
    const by = (s: string) => res.body.places.find((p: { source: string }) => p.source === s);
    expect(by("own").place).toMatchObject({
      lat: 50,
      lon: 8,
      country: "DE",
      // A saved place has no zone of its own: the pick derives it from the coordinates.
      zone: "Europe/Berlin",
      ref: { kind: "place" },
    });
    expect(by("port").place).toMatchObject({
      country: "DE",
      zone: "Europe/Berlin",
      ref: { kind: "port", id: String(portId) },
    });
    expect(by("geocoder").place).toMatchObject({
      name: unique + " Town, Bavaria",
      zone: "Europe/Berlin",
      ref: { kind: "geo", id: "7" },
    });
    expect(res.body.unavailable).toEqual([]);
  });

  it("names a failing geocoder instead of answering as if nothing matched", async () => {
    mockFind.mockRejectedValueOnce(new AppError("down", 503, "PLAN_WEATHER_UNAVAILABLE"));
    const res = await as(owner).get("/travplan/places?q=" + unique);
    expect(res.status).toBe(200);
    expect(res.body.unavailable).toEqual([
      { source: "geocoder", code: "PLAN_WEATHER_UNAVAILABLE" },
    ]);
    expect(res.body.places.map((p: { source: string }) => p.source)).toEqual(
      expect.arrayContaining(["own", "port"])
    );
  });

  it("does not offer another account's places", async () => {
    mockFind.mockResolvedValueOnce([]);
    const res = await as(stranger).get("/travplan/places?q=" + unique);
    expect(res.body.places.map((p: { source: string }) => p.source)).toEqual(["port"]);
  });
});

describe("plan delete", () => {
  async function planWithFlight() {
    const created = await as(owner).post("/travplan/plans", {
      name: "Delete me",
      clientRef: randomUUID(),
      settings: { destination: "Kiel", startDay: "2026-05-01", endDay: "2026-05-03" },
    });
    expect(created.status).toBe(201);
    const tripId = created.body.tripId as string;
    return { tripId, plan: created.body };
  }

  it("previews what goes and what stays, then removes only the plan - the trip stays", async () => {
    const { tripId, plan } = await planWithFlight();
    await as(owner).post("/trips/" + tripId + "/plan/mutations", {
      clientRef: randomUUID(),
      baseRevision: plan.revision,
      operation: {
        type: "upsert",
        collection: "tasks",
        value: { id: randomUUID(), title: "Pack", due: null, done: false },
      },
    });
    const preview = await as(owner).get("/trips/" + tripId + "/plan/delete-preview");
    expect(preview.status).toBe(200);
    expect(preview.body.removes).toMatchObject({ tasks: 1, receipts: 1 });
    expect(preview.body.tripIsEmptyShell).toBe(true);

    const res = await as(owner).del("/trips/" + tripId + "/plan");
    expect(res.status).toBe(200);
    expect(await prisma.travelPlan.count({ where: { tripId } })).toBe(0);
    expect(await prisma.travelPlanMutation.count({ where: { plan: { tripId } } })).toBe(0);
    expect(await prisma.trip.count({ where: { id: tripId } })).toBe(1);
    expect((await as(owner).get("/trips/" + tripId + "/plan")).status).toBe(404);
  });

  it("refuses to delete a plan that belongs to someone else", async () => {
    const { tripId } = await planWithFlight();
    const res = await as(stranger).del("/trips/" + tripId + "/plan");
    expect(res.status).toBe(404);
    expect(await prisma.travelPlan.count({ where: { tripId } })).toBe(1);
  });
});
