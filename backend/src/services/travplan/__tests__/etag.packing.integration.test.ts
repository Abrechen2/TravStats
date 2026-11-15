import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { JWT_SECRET } from "../../../utils/jwtSecret";
import travplanRouter from "../../../routes/travplan";
import { errorHandler } from "../../../middleware/errorHandler";
import { planEtag } from "../../sharing/federation/plans/shared";

jest.mock("../availability", () => ({
  travPlanOffered: async () => true,
  assertTravPlanOffered: async () => undefined,
  travPlanUserEnabled: async () => true,
  assertTravPlanForUser: async () => undefined,
}));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1", travplanRouter);
app.use(errorHandler);

let owner: string;
const cookie = () => "auth_token=" + jwt.sign({ userId: owner, epoch: 0 }, JWT_SECRET);

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { username: "etag-packing-" + randomUUID(), passwordHash: "x" },
  });
  owner = user.id;
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: owner } });
  await prisma.$disconnect();
});

describe("plan ETag follows the trip's packing list", () => {
  it("a Companion write to the packing list changes the ETag, so the poll refreshes instead of 304", async () => {
    const created = await request(app)
      .post("/api/v1/travplan/plans")
      .set("Cookie", cookie())
      .send({
        name: "Etag trip",
        clientRef: randomUUID(),
        settings: { destination: "Madeira", startDay: "2027-03-10", endDay: "2027-03-17" },
      });
    expect(created.status).toBe(201);
    const tripId = created.body.tripId as string;

    const first = await request(app).get(`/api/v1/trips/${tripId}/plan`).set("Cookie", cookie());
    const etag = first.headers.etag as string;
    const unchanged = await request(app)
      .get(`/api/v1/trips/${tripId}/plan`)
      .set("Cookie", cookie())
      .set("If-None-Match", etag);
    expect(unchanged.status).toBe(304);

    // The Companion's write: the packing list moves on, the plan's own revision does not.
    await prisma.tripPackingList.upsert({
      where: { tripId },
      create: { tripId, userId: owner, items: [], rev: 2 },
      update: { rev: { increment: 1 } },
    });
    const after = await request(app)
      .get(`/api/v1/trips/${tripId}/plan`)
      .set("Cookie", cookie())
      .set("If-None-Match", etag);
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(etag);
    expect(after.headers.etag).toBe(planEtag(after.body));
  });

  it("the host's and the local ETag are one function of revision, packing rev and member", () => {
    const a = planEtag({ revision: 3, packingRev: 4, self: { memberId: "m" } as never });
    const b = planEtag({ revision: 3, packingRev: 5, self: { memberId: "m" } as never });
    expect(a).not.toBe(b);
  });
});
