import { ipKeyGenerator } from "express-rate-limit";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { hashPassword } from "../../utils/password";
import logger, { dbLogger, httpLogger, securityLogger, systemLogger } from "../../utils/logger";
import { setLocationProvider } from "../../services/locationProvider/provider";
import * as dirtyDays from "../../services/travtrack/dirtyDays";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";
import {
  overlandBatch,
  owntracksAndroidLocation,
  owntracksIosLocation,
  owntracksTransition,
  TEST_LAT,
  TEST_LON,
} from "../../services/travtrack/sources/__fixtures__/requests";
import {
  INGEST_AUTH_FAILURES_PER_WINDOW,
  INGEST_PER_ACCOUNT_PER_MINUTE,
  INGEST_PER_TOKEN_PER_MINUTE,
  ingestAccountLimiter,
  ingestAuthFailureLimiter,
  ingestTokenCreateLimiter,
} from "../../middleware/ingestSourceLimits";

/**
 * OwnTracks and Overland into TravTrack over HTTP (TravTrack plan E9, review
 * focus 25). A per-device token posts points for its owner and does nothing
 * else: OwnTracks authenticates with HTTP Basic only, Overland with the Bearer
 * header only, a token works on its own app's path only, and no log line
 * carries one. OwnTracks always hears `[]` once authenticated; Overland hears
 * `result: ok` only after the transaction committed.
 */

const PREFIX = "travtrack-ingest-src-";
const OT = "/api/v1/travtrack/ingest/owntracks";
const OL = "/api/v1/travtrack/ingest/overland";

const basic = (token: string, user = "pixel") =>
  `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;

describe("TravTrack — OwnTracks and Overland", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;
  let owntracks: { id: string; token: string; url: string };
  let overland: { id: string; token: string; url: string };

  const mint = async (kind: "owntracks" | "overland", label = "Telefon") => {
    const res = await request(app)
      .post("/api/v1/travtrack/ingest-tokens")
      .set("Cookie", cookie)
      .send({ kind, label });
    expect(res.status).toBe(201);
    return res.body as { id: string; token: string; url: string };
  };

  const pointCount = () => prisma.travTrackPoint.count({ where: { userId } });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await setLocationProvider(userId, "travtrack");
    await wipeTravTrack([userId]);
    await prisma.travTrackIngestToken.deleteMany({ where: { userId } });
    await prisma.apiToken.deleteMany({ where: { userId } });
    await ingestAccountLimiter.resetKey(`ingest-user:${userId}`);
    await ingestTokenCreateLimiter.resetKey(`user:${userId}`);
    for (const ip of ["::ffff:127.0.0.1", "127.0.0.1", "::1"]) {
      await ingestAuthFailureLimiter.resetKey(`ingest-fail:${ipKeyGenerator(ip)}`);
    }
    owntracks = await mint("owntracks");
    overland = await mint("overland");
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { username: "demo", isDemo: true } });
    await prisma.$disconnect();
  });

  describe("tokens", () => {
    it("creating shows the token once with the app's URL; the list never shows it", async () => {
      expect(owntracks.token).toMatch(/^tt_ingest_[0-9a-f]{64}$/);
      expect(owntracks.url).toMatch(/\/api\/v1\/travtrack\/ingest\/owntracks$/);
      expect(overland.url).toMatch(/\/api\/v1\/travtrack\/ingest\/overland$/);
      const list = await request(app).get("/api/v1/travtrack/ingest-tokens").set("Cookie", cookie);
      expect(list.status).toBe(200);
      expect(list.body.tokens).toHaveLength(2);
      expect(JSON.stringify(list.body)).not.toContain(owntracks.token);
      expect(list.body.tokens[0]).toEqual({
        id: expect.any(String),
        kind: expect.stringMatching(/^(owntracks|overland)$/),
        label: "Telefon",
        createdAt: expect.any(String),
        lastUsedAt: null,
      });
    });

    it("creating and revoking need write scope and refuse the demo account", async () => {
      const read = await generateApiToken();
      await prisma.apiToken.create({
        data: { userId, label: "r", lookupHash: read.lookupHash, hash: read.hash, scope: "read" },
      });
      const bearer = `Bearer ${read.plaintext}`;
      const create = await request(app)
        .post("/api/v1/travtrack/ingest-tokens")
        .set("Authorization", bearer)
        .send({ kind: "owntracks", label: "x" });
      expect(create.status).toBe(403);
      const revoke = await request(app)
        .delete(`/api/v1/travtrack/ingest-tokens/${owntracks.id}`)
        .set("Authorization", bearer);
      expect(revoke.status).toBe(403);

      await prisma.user.deleteMany({ where: { username: "demo" } });
      const demo = await prisma.user.create({
        data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
      });
      const demoCookie = `auth_token=${generateToken(demo.id)}`;
      const demoCreate = await request(app)
        .post("/api/v1/travtrack/ingest-tokens")
        .set("Cookie", demoCookie)
        .send({ kind: "owntracks", label: "x" });
      expect(demoCreate.status).toBe(403);
      expect(await prisma.travTrackIngestToken.count({ where: { userId: demo.id } })).toBe(0);
    });

    it("creating validates kind and label", async () => {
      for (const body of [{ kind: "gpx", label: "x" }, { kind: "owntracks", label: "" }, {}]) {
        const res = await request(app)
          .post("/api/v1/travtrack/ingest-tokens")
          .set("Cookie", cookie)
          .send(body);
        expect(res.status).toBe(400);
      }
      const long = await request(app)
        .post("/api/v1/travtrack/ingest-tokens")
        .set("Cookie", cookie)
        .send({ kind: "owntracks", label: "x".repeat(61) });
      expect(long.status).toBe(400);
    });

    it("creating is refused while the account's provider is not TravTrack", async () => {
      await setLocationProvider(userId, "none");
      const res = await request(app)
        .post("/api/v1/travtrack/ingest-tokens")
        .set("Cookie", cookie)
        .send({ kind: "owntracks", label: "x" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("TRAVTRACK_NOT_ACTIVE");
    });

    it("a revoked token is 401", async () => {
      const del = await request(app)
        .delete(`/api/v1/travtrack/ingest-tokens/${owntracks.id}`)
        .set("Cookie", cookie);
      expect(del.status).toBe(200);
      expect(del.body).toEqual({ revoked: true });
      const res = await request(app)
        .post(OT)
        .set("Authorization", basic(owntracks.token))
        .send(owntracksAndroidLocation);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INGEST_TOKEN_INVALID");
      expect(await pointCount()).toBe(0);
    });
  });

  describe("authentication", () => {
    it("OwnTracks takes Basic with the token as password and refuses Bearer", async () => {
      const ok = await request(app)
        .post(OT)
        .set("Authorization", basic(owntracks.token))
        .send(owntracksAndroidLocation);
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual([]);
      expect(await pointCount()).toBe(1);

      const bearer = await request(app)
        .post(OT)
        .set("Authorization", `Bearer ${owntracks.token}`)
        .send(owntracksIosLocation);
      expect(bearer.status).toBe(401);
      expect(bearer.body.code).toBe("INGEST_TOKEN_INVALID");
      const none = await request(app).post(OT).send(owntracksIosLocation);
      expect(none.status).toBe(401);
      expect(await pointCount()).toBe(1);
    });

    it("Overland takes the Bearer header and refuses a query token and Basic", async () => {
      const ok = await request(app)
        .post(OL)
        .set("Authorization", `Bearer ${overland.token}`)
        .send(overlandBatch);
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ result: "ok" });
      await wipeTravTrack([userId]);

      const query = await request(app).post(`${OL}?token=${overland.token}`).send(overlandBatch);
      expect(query.status).toBe(401);
      expect(query.body.code).toBe("INGEST_TOKEN_INVALID");
      // A token in the URL is refused even beside a valid header.
      const both = await request(app)
        .post(`${OL}?access_token=${overland.token}`)
        .set("Authorization", `Bearer ${overland.token}`)
        .send(overlandBatch);
      expect(both.status).toBe(401);
      const viaBasic = await request(app)
        .post(OL)
        .set("Authorization", basic(overland.token))
        .send(overlandBatch);
      expect(viaBasic.status).toBe(401);
      expect(await pointCount()).toBe(0);
    });

    it("an OwnTracks token on the Overland path is 401 INGEST_TOKEN_INVALID", async () => {
      const res = await request(app)
        .post(OL)
        .set("Authorization", `Bearer ${owntracks.token}`)
        .send(overlandBatch);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INGEST_TOKEN_INVALID");
      const back = await request(app)
        .post(OT)
        .set("Authorization", basic(overland.token))
        .send(owntracksAndroidLocation);
      expect(back.status).toBe(401);
      expect(await pointCount()).toBe(0);
    });

    it("a token cannot read /travtrack/points or call any other route", async () => {
      const span = "from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z";
      for (const auth of [`Bearer ${overland.token}`, basic(owntracks.token)]) {
        const calls = [
          request(app).get(`/api/v1/travtrack/points?${span}`).set("Authorization", auth),
          request(app).get("/api/v1/travtrack/summary").set("Authorization", auth),
          request(app).get("/api/v1/travtrack/ingest-tokens").set("Authorization", auth),
          request(app)
            .post("/api/v1/travtrack/ingest-tokens")
            .set("Authorization", auth)
            .send({ kind: "owntracks", label: "x" }),
          request(app).get("/api/v1/flights").set("Authorization", auth),
          request(app).get("/api/v1/auth/me").set("Authorization", auth),
        ];
        for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
      }
    });

    it("the token's last use is recorded", async () => {
      await request(app)
        .post(OT)
        .set("Authorization", basic(owntracks.token))
        .send(owntracksAndroidLocation)
        .expect(200);
      const row = await prisma.travTrackIngestToken.findUniqueOrThrow({
        where: { id: owntracks.id },
      });
      expect(row.lastUsedAt).not.toBeNull();
    });
  });

  describe("pipeline", () => {
    it("the recorded OwnTracks location is stored as its own device, speed in m/s", async () => {
      await request(app)
        .post(OT)
        .set("Authorization", basic(owntracks.token))
        .send([owntracksAndroidLocation, owntracksTransition])
        .expect(200, []);
      const [p] = await prisma.travTrackPoint.findMany({ where: { userId } });
      expect(p).toMatchObject({
        lat: TEST_LAT,
        lon: TEST_LON,
        speedMps: 5,
        accuracyM: 13,
        origin: `owntracks:${owntracks.id}`,
        deviceId: `owntracks:${owntracks.id}`,
        purpose: "everyday",
      });
    });

    it("an empty OwnTracks POST and a transition store nothing and answer []", async () => {
      for (const send of [
        (r: request.Test) => r,
        (r: request.Test) => r.send({}),
        (r: request.Test) => r.send(owntracksTransition),
        (r: request.Test) => r.set("Content-Type", "application/json").send(""),
      ]) {
        const res = await send(request(app).post(OT).set("Authorization", basic(owntracks.token)));
        expect([res.status, res.body]).toEqual([200, []]);
      }
      expect(await pointCount()).toBe(0);
    });

    it("an OwnTracks point inside a zone is dropped and the answer is still []", async () => {
      await prisma.travTrackPrivacyZone.create({
        data: { userId, name: "Zuhause", lat: TEST_LAT, lon: TEST_LON, radiusM: 250 },
      });
      const res = await request(app)
        .post(OT)
        .set("Authorization", basic(owntracks.token))
        .send(owntracksAndroidLocation);
      expect([res.status, res.body]).toEqual([200, []]);
      expect(await pointCount()).toBe(0);
    });

    it("a malformed OwnTracks message is counted, never refused", async () => {
      const res = await request(app)
        .post(OT)
        .set("Authorization", basic(owntracks.token))
        .send([
          { _type: "location", lat: 999, lon: TEST_LON, tst: 1_792_483_200 },
          owntracksIosLocation,
        ]);
      expect([res.status, res.body]).toEqual([200, []]);
      expect(await pointCount()).toBe(1);
    });

    it("an OwnTracks tst no Date can hold is counted; its siblings are stored", async () => {
      const res = await request(app)
        .post(OT)
        .set("Authorization", basic(owntracks.token))
        .send([{ ...owntracksAndroidLocation, tst: 9_000_000_000_000 }, owntracksIosLocation]);
      expect([res.status, res.body]).toEqual([200, []]);
      expect(await pointCount()).toBe(1);
    });

    it("the recorded Overland batch stores every point and answers result ok", async () => {
      const res = await request(app)
        .post(OL)
        .set("Authorization", `Bearer ${overland.token}`)
        .send(overlandBatch);
      expect([res.status, res.body]).toEqual([200, { result: "ok" }]);
      const points = await prisma.travTrackPoint.findMany({
        where: { userId },
        orderBy: { t: "asc" },
      });
      expect(points).toHaveLength(3);
      expect(points[0].t.toISOString()).toBe("2026-10-20T08:00:00.000Z");
      expect(points.every((p) => p.origin === `overland:${overland.id}`)).toBe(true);
      expect(points[2]).toMatchObject({ speedMps: null, accuracyM: null });
    });

    it("a resent Overland batch stores nothing twice", async () => {
      for (let i = 0; i < 2; i++) {
        await request(app)
          .post(OL)
          .set("Authorization", `Bearer ${overland.token}`)
          .send(overlandBatch)
          .expect(200, { result: "ok" });
      }
      expect(await pointCount()).toBe(3);
    });

    it("an empty Overland batch answers result ok; a body without locations is 400", async () => {
      await request(app)
        .post(OL)
        .set("Authorization", `Bearer ${overland.token}`)
        .send({ locations: [] })
        .expect(200, { result: "ok" });
      const bad = await request(app)
        .post(OL)
        .set("Authorization", `Bearer ${overland.token}`)
        .send({ nope: true });
      expect(bad.status).toBe(400);
    });

    it("a failure inside the transaction answers 5xx, never result ok", async () => {
      jest.spyOn(dirtyDays, "markTravTrackDaysDirty").mockRejectedValue(new Error("disk on fire"));
      const res = await request(app)
        .post(OL)
        .set("Authorization", `Bearer ${overland.token}`)
        .send(overlandBatch);
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(res.body).not.toEqual({ result: "ok" });
      expect(await pointCount()).toBe(0);
      const ot = await request(app)
        .post(OT)
        .set("Authorization", basic(owntracks.token))
        .send(owntracksAndroidLocation);
      expect(ot.status).toBeGreaterThanOrEqual(500);
      expect(await pointCount()).toBe(0);
    });

    it("a body over the location limit is 413 and stores nothing", async () => {
      const big = {
        locations: Array.from({ length: 12_000 }, () => overlandBatch.locations[0]),
      };
      const res = await request(app)
        .post(OL)
        .set("Authorization", `Bearer ${overland.token}`)
        .send(big);
      expect(res.status).toBe(413);
      expect(await pointCount()).toBe(0);
    });

    it("TravTrack off: 403, nothing stored", async () => {
      await switches.set({ beta: true, config: false });
      const ot = await request(app)
        .post(OT)
        .set("Authorization", basic(owntracks.token))
        .send(owntracksAndroidLocation);
      expect([ot.status, ot.body.code]).toEqual([403, "TRAVTRACK_DISABLED"]);
      const ol = await request(app)
        .post(OL)
        .set("Authorization", `Bearer ${overland.token}`)
        .send(overlandBatch);
      expect([ol.status, ol.body.code]).toEqual([403, "TRAVTRACK_DISABLED"]);
      expect(await pointCount()).toBe(0);
    });

    describe("after the provider left TravTrack", () => {
      // The fixtures are recorded at 2026-10-20T08:00Z (Overland: 08:00–08:02).
      const leaveAt = async (iso: string | null) => {
        await setLocationProvider(userId, "none");
        await prisma.userSettings.update({
          where: { userId },
          data: { travtrackLeftAt: iso === null ? null : new Date(iso) },
        });
      };

      it("points recorded before the switch are stored and answered as usual", async () => {
        await leaveAt("2026-10-21T00:00:00Z");
        await request(app)
          .post(OT)
          .set("Authorization", basic(owntracks.token))
          .send(owntracksAndroidLocation)
          .expect(200, []);
        await request(app)
          .post(OL)
          .set("Authorization", `Bearer ${overland.token}`)
          .send(overlandBatch)
          .expect(200, { result: "ok" });
        // Overland's first fix is the OwnTracks one again (same second and place).
        expect(await pointCount()).toBe(3);
      });

      it("points recorded after it: 403 TRAVTRACK_NOT_ACTIVE, nothing stored", async () => {
        await leaveAt("2026-10-19T00:00:00Z");
        const ot = await request(app)
          .post(OT)
          .set("Authorization", basic(owntracks.token))
          .send(owntracksAndroidLocation);
        expect([ot.status, ot.body.code]).toEqual([403, "TRAVTRACK_NOT_ACTIVE"]);
        const ol = await request(app)
          .post(OL)
          .set("Authorization", `Bearer ${overland.token}`)
          .send(overlandBatch);
        expect([ol.status, ol.body.code]).toEqual([403, "TRAVTRACK_NOT_ACTIVE"]);
        expect(await pointCount()).toBe(0);
      });

      it("a mixed batch stores the earlier points and still refuses: never ok for a dropped one", async () => {
        // Between the Overland batch's second (08:01) and third (08:02) point.
        await leaveAt("2026-10-20T08:01:30Z");
        const ol = await request(app)
          .post(OL)
          .set("Authorization", `Bearer ${overland.token}`)
          .send(overlandBatch);
        expect(ol.status).toBe(403);
        expect(ol.body).toMatchObject({ code: "TRAVTRACK_NOT_ACTIVE", stored: 2, refused: 1 });
        expect(await pointCount()).toBe(2);
        // The phone resends the whole batch: nothing is stored twice.
        const again = await request(app)
          .post(OL)
          .set("Authorization", `Bearer ${overland.token}`)
          .send(overlandBatch);
        expect(again.body).toMatchObject({ stored: 0, refused: 1 });
        expect(await pointCount()).toBe(2);

        const ot = await request(app)
          .post(OT)
          .set("Authorization", basic(owntracks.token))
          .send([
            { ...owntracksIosLocation, tst: 1_792_483_200 + 30 },
            { ...owntracksAndroidLocation, tst: 1_792_483_200 + 600 },
          ]);
        expect([ot.status, ot.body.code]).toEqual([403, "TRAVTRACK_NOT_ACTIVE"]);
        expect(await pointCount()).toBe(3);
      });

      it("an account that never had TravTrack as its provider gets nothing stored", async () => {
        await leaveAt(null);
        const ot = await request(app)
          .post(OT)
          .set("Authorization", basic(owntracks.token))
          .send(owntracksAndroidLocation);
        expect([ot.status, ot.body.code]).toEqual([403, "TRAVTRACK_NOT_ACTIVE"]);
        expect(await pointCount()).toBe(0);
      });

      it("a message holding no location is still answered [] (nothing to refuse)", async () => {
        await leaveAt(null);
        await request(app)
          .post(OT)
          .set("Authorization", basic(owntracks.token))
          .send(owntracksTransition)
          .expect(200, []);
      });
    });

    it("no log line carries a token", async () => {
      const lines: string[] = [];
      for (const l of [logger, dbLogger, httpLogger, securityLogger, systemLogger]) {
        for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const) {
          jest.spyOn(l, level).mockImplementation(((...args: unknown[]) => {
            lines.push(JSON.stringify(args));
          }) as never);
        }
      }
      await request(app)
        .post(OT)
        .set("Authorization", basic(owntracks.token))
        .send(owntracksAndroidLocation);
      await request(app).post(OT).set("Authorization", `Bearer ${owntracks.token}`).send({});
      await request(app).post(`${OL}?token=${overland.token}`).send(overlandBatch);
      await request(app)
        .post(OL)
        .set("Authorization", `Bearer ${overland.token}`)
        .send(overlandBatch);
      await request(app).post(OL).set("Authorization", `Bearer ${owntracks.token}`).send({});
      const created = await mint("overland", "Neu");
      expect(lines.length).toBeGreaterThan(0);
      const all = lines.join("\n");
      for (const t of [owntracks.token, overland.token, created.token]) {
        expect(all).not.toContain(t);
        expect(all).not.toContain(t.slice("tt_ingest_".length));
        expect(all).not.toContain(Buffer.from(`pixel:${t}`).toString("base64"));
      }
    });
  });

  describe("rate limits", () => {
    const emptyPost = (token: string) =>
      request(app).post(OT).set("Authorization", basic(token)).send({});

    it("a token is limited by its id, and the account across its tokens", async () => {
      for (let i = 0; i < INGEST_PER_TOKEN_PER_MINUTE; i++) {
        expect((await emptyPost(owntracks.token)).status).toBe(200);
      }
      const limited = await emptyPost(owntracks.token);
      expect([limited.status, limited.body.code]).toEqual([429, "RATE_LIMITED"]);
      // Another token of the account has a bucket of its own …
      expect((await emptyPost((await mint("owntracks")).token)).status).toBe(200);
      // … until the account's bucket is spent.
      let used = INGEST_PER_TOKEN_PER_MINUTE + 1;
      while (used < INGEST_PER_ACCOUNT_PER_MINUTE) {
        const fresh = (await mint("owntracks")).token;
        for (
          let i = 0;
          i < INGEST_PER_TOKEN_PER_MINUTE && used < INGEST_PER_ACCOUNT_PER_MINUTE;
          i++
        ) {
          expect((await emptyPost(fresh)).status).toBe(200);
          used += 1;
        }
      }
      const spent = await emptyPost((await mint("owntracks")).token);
      expect([spent.status, spent.body.code]).toEqual([429, "RATE_LIMITED"]);
    });

    it("an address that keeps failing to authenticate is slowed down", async () => {
      const wrong = `tt_ingest_${"0".repeat(64)}`;
      for (let i = 0; i < INGEST_AUTH_FAILURES_PER_WINDOW; i++) {
        expect((await emptyPost(wrong)).status).toBe(401);
      }
      expect((await emptyPost(wrong)).status).toBe(429);
      // Only failures are slowed: a device with a good token at the same address
      // (one home connection, one reverse proxy) is not locked out by them.
      expect((await emptyPost(owntracks.token)).status).toBe(200);
    });
  });
});
