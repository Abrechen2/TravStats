import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import travtrackRouter from "../travtrack";
import type { TravTrackTier } from "../travtrack/gate";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";

/**
 * TravTrack's gate (TravTrack plan T1, review focus 14): every route names a
 * tier, and the tiers answer what they promise — `on` refuses while the
 * instance is off, `held` stays open for an account that holds data, and the
 * admin config is reachable while TravTrack itself is still off.
 */

const PREFIX = "travtrack-gate-";

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
  handle?: { stack?: Layer[] };
};

type Route = { method: string; path: string; tier: TravTrackTier | null };

function routesOf(stack: Layer[]): Route[] {
  return stack.flatMap((layer): Route[] => {
    if (layer.route) {
      const tiers = layer.route.stack
        .map((l) => (l.handle as { travTrackTier?: TravTrackTier }).travTrackTier)
        .filter((t): t is TravTrackTier => t !== undefined);
      return Object.keys(layer.route.methods).map((method) => ({
        method,
        path: layer.route!.path,
        tier: tiers[0] ?? null,
      }));
    }
    return layer.handle?.stack ? routesOf(layer.handle.stack) : [];
  });
}

const ROUTES = routesOf((travtrackRouter as unknown as { stack: Layer[] }).stack);
const UUID = "00000000-0000-4000-8000-000000000000";
const concrete = (path: string) => `/api/v1${path.replace(/:[A-Za-z]+/g, UUID)}`;

describe("TravTrack gate", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let adminId: string;
  let cookie: string;
  let adminCookie: string;
  let readOnly: string;

  const call = (method: string, path: string, auth = cookie) => {
    const r = request(app)[method as "get" | "post" | "patch" | "delete" | "put"](path);
    return auth.startsWith("Bearer") ? r.set("Authorization", auth) : r.set("Cookie", auth);
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    userId = (await prisma.user.create({ data: { username: `${PREFIX}u`, passwordHash: "x" } })).id;
    adminId = (
      await prisma.user.create({
        data: { username: `${PREFIX}admin`, passwordHash: "x", isAdmin: true },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    adminCookie = `auth_token=${generateToken(adminId)}`;
    const t = await generateApiToken();
    await prisma.apiToken.create({
      data: {
        userId: adminId,
        label: "read",
        lookupHash: t.lookupHash,
        hash: t.hash,
        scope: "read",
      },
    });
    readOnly = `Bearer ${t.plaintext}`;
  });

  beforeEach(async () => {
    await prisma.travTrackPrivacyZone.deleteMany({ where: { userId } });
    await prisma.travTrackDeletedRange.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("every registered /travtrack route names a tier", () => {
    expect(ROUTES.length).toBeGreaterThan(0);
    expect(ROUTES.filter((r) => r.tier === null).map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it("each route sits in the tier the plan names for it", () => {
    const tiers = Object.fromEntries(ROUTES.map((r) => [`${r.method} ${r.path}`, r.tier]));
    expect(tiers).toEqual({
      "get /travtrack/capabilities": "open",
      "get /travtrack/config": "offered",
      "patch /travtrack/config": "offered",
      "post /travtrack/points": "on",
      "get /travtrack/points": "on",
      "get /travtrack/summary": "held",
      "delete /travtrack/points": "held",
      "get /travtrack/zones": "held",
      "post /travtrack/zones": "on",
      "patch /travtrack/zones/:id": "on",
      "delete /travtrack/zones/:id": "held",
      "get /travtrack/day": "on",
      "get /travtrack/export": "held",
      "post /travtrack/imports": "on",
      "get /travtrack/imports": "held",
      "delete /travtrack/imports/:id": "held",
      "post /travtrack/ingest-tokens": "on",
      "get /travtrack/ingest-tokens": "held",
      "delete /travtrack/ingest-tokens/:id": "held",
      "post /travtrack/ingest/owntracks": "on",
      "post /travtrack/ingest/overland": "on",
      "get /trips/:id/share-snapshot": "held",
      "put /trips/:id/share-snapshot": "on",
      "delete /trips/:id/share-snapshot": "open",
      "get /trips/:id/shared-route": "on",
    });
  });

  it("capabilities answer 200 with offered/enabled false while off", async () => {
    await switches.set({ beta: false, config: false });
    const res = await call("get", "/api/v1/travtrack/capabilities").expect(200);
    expect(res.body).toEqual({
      version: 1,
      offered: false,
      enabled: false,
      active: false,
      hasData: false,
      sources: ["companion", "gpx", "owntracks", "overland"],
    });
    const read = await call("get", "/api/v1/travtrack/capabilities", readOnly);
    expect(read.status).toBe(200);
  });

  it("with TravTrack off, every on-tier route answers 403 TRAVTRACK_DISABLED", async () => {
    await switches.set({ beta: true, config: false });
    // Data held does not open the `on` tier.
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zuhause", lat: 1, lon: 1, radiusM: 100 },
    });
    for (const r of ROUTES.filter((x) => x.tier === "on")) {
      const res = await call(r.method, concrete(r.path)).send({});
      expect({ route: `${r.method} ${r.path}`, status: res.status, code: res.body.code }).toEqual({
        route: `${r.method} ${r.path}`,
        status: 403,
        code: "TRAVTRACK_DISABLED",
      });
    }
  });

  it("with TravTrack off, an account holding data passes the held tier", async () => {
    await switches.set({ beta: true, config: false });
    await prisma.travTrackDeletedRange.create({
      data: { userId, fromAt: new Date("2026-01-01Z"), toAt: new Date("2026-01-02Z") },
    });
    for (const r of ROUTES.filter((x) => x.tier === "held")) {
      const res = await call(r.method, concrete(r.path)).send({});
      expect(`${r.method} ${r.path} ${res.body.code ?? ""}`).not.toMatch(/TRAVTRACK_DISABLED/);
    }
  });

  it("with TravTrack off, an account holding nothing gets 403 on the held tier too", async () => {
    await switches.set({ beta: true, config: false });
    for (const r of ROUTES.filter((x) => x.tier === "held")) {
      const res = await call(r.method, concrete(r.path)).send({});
      expect([`${r.method} ${r.path}`, res.status, res.body.code]).toEqual([
        `${r.method} ${r.path}`,
        403,
        "TRAVTRACK_DISABLED",
      ]);
    }
  });

  it("the admin can PATCH the config while the beta switch is on and TravTrack is still off", async () => {
    await switches.set({ beta: true, config: false });
    const res = await call("patch", "/api/v1/travtrack/config", adminCookie)
      .send({ enabled: true })
      .expect(200);
    expect(res.body).toEqual({ enabled: true });
    expect((await call("get", "/api/v1/travtrack/config", adminCookie)).body).toEqual({
      enabled: true,
    });
    const caps = await call("get", "/api/v1/travtrack/capabilities").expect(200);
    expect(caps.body).toMatchObject({ offered: true, enabled: true });
  });

  it("config answers 403 while the beta switch is off", async () => {
    await switches.set({ beta: false, config: false });
    const res = await call("get", "/api/v1/travtrack/config", adminCookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
    const patch = await call("patch", "/api/v1/travtrack/config", adminCookie).send({
      enabled: true,
    });
    expect(patch.status).toBe(403);
  });

  it("admin config needs admin, PATCH needs write scope", async () => {
    await switches.set({ beta: true, config: false });
    expect((await call("get", "/api/v1/travtrack/config")).status).toBe(403);
    expect((await call("patch", "/api/v1/travtrack/config").send({ enabled: true })).status).toBe(
      403
    );
    // A token needs the admin scope for any admin route (`requireAdmin`).
    expect((await call("get", "/api/v1/travtrack/config", readOnly)).status).toBe(403);
    const read = await call("patch", "/api/v1/travtrack/config", readOnly).send({ enabled: true });
    expect(read.status).toBe(403);
    expect(
      (await call("patch", "/api/v1/travtrack/config", adminCookie).send({ enabled: "yes" })).status
    ).toBe(400);
  });
});
