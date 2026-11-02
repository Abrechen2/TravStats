/**
 * A guest credential opens ONE door. This walks the router table the running app mounts and
 * proves that no other endpoint treats a `ts_guest` cookie or a `ts_gpat_` token as a login:
 * wherever an endpoint answers 401 to a caller with no credential at all, it answers 401 to a
 * valid guest credential too. Written as an enumeration so a router added next year is covered
 * the day it is mounted.
 */
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { prisma } from "../../../../db";
import { apiMounts } from "../../../../routes/mounts";
import { listMountedEndpoints } from "../../../openapi/coverage";
import { errorHandler } from "../../../../middleware/errorHandler";
import { issueCredential } from "../sessions";

jest.mock("../../availability", () => ({
  travPlanOffered: async () => true,
  assertTravPlanOffered: async () => undefined,
  travPlanUserEnabled: async () => true,
  assertTravPlanForUser: async () => undefined,
}));

const ORIGIN = "https://enumeration.example";
const SKIPPED_MOUNTS = new Set(["guest", "setup", "openapi"]);

const app = express();
app.use(express.json());
app.use(cookieParser());
for (const m of apiMounts) app.use(m.base, m.router);
app.use(errorHandler);

let cookie = "";
let pat = "";
let ownerId = "";

beforeAll(async () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  await prisma.comparisonPeer.upsert({
    where: { origin: ORIGIN },
    create: {
      origin: ORIGIN,
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      enabled: true,
      verifiedAt: new Date(),
    },
    update: { enabled: true, verifiedAt: new Date() },
  });
  const owner = await prisma.user.create({
    data: { username: "enum-owner-" + randomUUID(), passwordHash: "x" },
  });
  ownerId = owner.id;
  const trip = await prisma.trip.create({ data: { userId: owner.id, name: "Enumeration" } });
  const plan = await prisma.travelPlan.create({
    data: { tripId: trip.id, createRef: randomUUID(), state: {} },
  });
  const member = await prisma.travelPlanMember.create({
    data: {
      planId: plan.id,
      kind: "remote",
      remoteOrigin: ORIGIN,
      remoteSubject: "9".repeat(64),
      displayName: "Enumerated",
      status: "active",
    },
  });
  cookie = (
    await issueCredential({ memberId: member.id, planId: plan.id, kind: "session", origin: ORIGIN })
  ).token;
  pat = (
    await issueCredential({ memberId: member.id, planId: plan.id, kind: "pat", origin: ORIGIN })
  ).token;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("the guest door", () => {
  it("is the only door a guest credential opens: every other endpoint that wants a login still wants one", async () => {
    const endpoints = listMountedEndpoints().filter((e) => !SKIPPED_MOUNTS.has(e.mountId));
    expect(endpoints.length).toBeGreaterThan(300);
    const fill = (path: string) => "/api/v1" + path.replace(/\{[^}]+\}/g, () => randomUUID());
    const leaks: string[] = [];
    let protectedCount = 0;
    for (const e of endpoints) {
      const method = e.method as "get" | "post" | "put" | "patch" | "delete";
      const url = fill(e.path);
      const bare = await request(app)[method](url).send({});
      if (bare.status !== 401) continue;
      protectedCount++;
      const viaCookie = await request(app)
        [method](url)
        .set("Cookie", "ts_guest=" + cookie)
        .set("X-TravStats-Guest", "1")
        .send({});
      const viaPat = await request(app)
        [method](url)
        .set("Authorization", "Bearer " + pat)
        .send({});
      if (viaCookie.status !== 401) leaks.push(`${method} ${e.path} cookie -> ${viaCookie.status}`);
      if (viaPat.status !== 401) leaks.push(`${method} ${e.path} pat -> ${viaPat.status}`);
    }
    expect(protectedCount).toBeGreaterThan(200);
    expect(leaks).toEqual([]);
    expect(ownerId).not.toBe("");
  }, 300_000);

  it("opens no guest path to anyone without a guest credential", async () => {
    const guestEndpoints = listMountedEndpoints().filter((e) => e.mountId === "guest");
    expect(guestEndpoints.length).toBeGreaterThan(10);
    for (const e of guestEndpoints) {
      if (e.path.startsWith("/guest/join/")) continue;
      const method = e.method as "get" | "post" | "put" | "patch" | "delete";
      const url = "/api/v1" + e.path.replace(/\{[^}]+\}/g, () => randomUUID());
      const r = await request(app)[method](url).send({});
      expect([e.path, r.status]).toEqual([e.path, 401]);
    }
  });
});
