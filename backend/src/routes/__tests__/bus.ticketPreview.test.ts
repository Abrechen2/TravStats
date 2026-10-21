import { randomUUID } from "crypto";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { generateToken } from "../../utils/jwt";
import { deriveBusTemplate } from "../../services/parsers/userTemplates/rideDeriver";
import {
  BUS_FOREIGN,
  BUS_HELD_OUT,
  BUS_SELECTIONS,
  BUS_SOURCE,
  BUS_SUBJECT,
} from "../../services/parsers/userTemplates/__tests__/rideSamples";

/**
 * forgejo#309: `POST /bus/ticket-preview` reads a coach ticket with the
 * caller's ACTIVE workshop template — stored as a real row, found through the
 * real loader — and declines with a code what no template reads.
 */
describe("POST /api/v1/bus/ticket-preview", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `bus-ticket-${randomUUID()}`, passwordHash: "not-a-login" },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    const derived = deriveBusTemplate({
      trainingDataId: "td-bus-route",
      subject: BUS_SUBJECT,
      fullText: BUS_SOURCE,
      selections: BUS_SELECTIONS,
    });
    if (!derived.ok) throw new Error(derived.refusal);
    await prisma.parserTemplate.create({
      data: {
        userId,
        domain: "bus",
        name: "Fernbus Probeland",
        status: "active",
        fingerprint: {},
        patterns: derived.template as unknown as Prisma.InputJsonValue,
      },
    });
  });

  afterAll(async () => {
    await prisma.parserTemplate.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("proposes every ride the user's bus template reads", async () => {
    const res = await request(app)
      .post("/api/v1/bus/ticket-preview")
      .set("Cookie", cookie)
      .send({ text: `${BUS_SUBJECT}\n${BUS_HELD_OUT}` });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      parser: "template",
      reason: null,
      template: { id: "bus:user-td-bus-route", source: "workshop" },
    });
    expect(res.body.data.rides).toHaveLength(3);
    expect(res.body.data.rides[2]).toMatchObject({
      departureStop: { value: "Musterhafen ZOB" },
      arrivalStop: { value: "Beispielberg" },
      departureLocal: { value: "2028-04-12T22:50" },
      arrivalLocal: { value: "2028-04-13T02:10" },
      lineName: { value: "N 43" },
      bookingReference: { value: "FBP-309922" },
    });
    // 44,50 EUR is the three rides' total, not the price of each.
    expect(res.body.data.rides.map((r: { price?: unknown }) => r.price)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("declines another operator's ticket with noTemplate, not an empty success", async () => {
    const res = await request(app)
      .post("/api/v1/bus/ticket-preview")
      .set("Cookie", cookie)
      .send({ text: BUS_FOREIGN });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      rides: [],
      parser: null,
      reason: "noTemplate",
      template: null,
    });
  });

  it("refuses a body that is neither text nor a document id", async () => {
    const res = await request(app)
      .post("/api/v1/bus/ticket-preview")
      .set("Cookie", cookie)
      .send({ text: "x", documentId: randomUUID() });
    expect(res.status).toBe(400);
  });
});
