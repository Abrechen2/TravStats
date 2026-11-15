import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { appVersion } from "../../utils/version";
import { generateApiToken } from "../../utils/apiTokens";
import { resetDiskCache } from "../../services/readiness/context";
import { resetProbeNonces } from "../../services/readiness/publicUrlProbe";
import { runPublicUrlCheckJob } from "../../jobs/publicUrlCheckScheduler";

/**
 * Readiness stage 2, server half (spec 2026-11-14 §12): the invitation keys, the
 * admin banner and the public-URL reachability producer. `fetch` is stubbed in
 * every probe test — nothing here touches the network.
 */

const NAMES = ["rdy2_admin", "rdy2_user", "demo"];
const PUBLIC_URL = "https://trav.example.test";

interface Invitation {
  show: boolean;
  reason: "update" | "required" | null;
  snoozedUntil: string | null;
  keys: string[];
}
interface View {
  invitation: Invitation;
  banner: { show: boolean; itemIds: string[] };
  items: { id: string; status: string }[];
  notes: { id: string; open: boolean }[];
}

describe("Readiness stage 2", () => {
  let adminCookie: string;
  let userCookie: string;
  let demoCookie: string;
  let adminId: string;
  let userId: string;
  let adminSettingsId: number;
  let original: {
    publicUrl: string | null;
    frontendUrl: string | null;
    internetEnabled: boolean;
  } | null = null;
  let fetchSpy: jest.SpyInstance;

  const view = async (cookie: string): Promise<View> =>
    (await request(app).get("/api/v1/readiness").set("Cookie", cookie)).body as View;

  /** A fetch that answers like /health, echoing the nonce it was sent unless told not to. */
  function stubHealth(opts: { status?: number; body?: Record<string, unknown>; echo?: boolean }) {
    fetchSpy.mockImplementation(async (input: unknown) => {
      const probe = new URL(String(input)).searchParams.get("probe");
      const body = { status: "ok", ...(opts.echo === false ? {} : { probe }), ...opts.body };
      return new Response(JSON.stringify(body), { status: opts.status ?? 200 });
    });
  }

  const stored = () =>
    prisma.adminSettings.findUniqueOrThrow({
      where: { id: adminSettingsId },
      select: { publicUrlCheckedAt: true, publicUrlCheckOk: true, publicUrlCheckedUrl: true },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
    const mk = async (username: string, isAdmin: boolean, isDemo = false) =>
      prisma.user.create({
        data: {
          username,
          passwordHash: await hashPassword("password123"),
          isAdmin,
          isDemo,
          readinessAckVersion: "2.7.0",
        },
      });
    const admin = await mk(NAMES[0], true);
    const user = await mk(NAMES[1], false);
    const demo = await mk(NAMES[2], false, true);
    adminId = admin.id;
    userId = user.id;
    adminCookie = `auth_token=${generateToken(admin.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
    demoCookie = `auth_token=${generateToken(demo.id)}`;
    const row =
      (await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } })) ??
      (await prisma.adminSettings.create({ data: {} }));
    adminSettingsId = row.id;
    original = {
      publicUrl: row.publicUrl,
      frontendUrl: row.frontendUrl,
      internetEnabled: row.internetEnabled,
    };
  });

  beforeEach(async () => {
    resetDiskCache();
    resetProbeNonces();
    fetchSpy = jest.spyOn(global, "fetch");
    await prisma.readinessItemState.deleteMany({});
    await prisma.readinessNoteAck.deleteMany({});
    await prisma.backup.deleteMany({});
    await prisma.user.updateMany({
      where: { id: { in: [adminId, userId] } },
      data: {
        readinessAckVersion: "2.7.0",
        readinessInvitationSeen: [],
        readinessInvitationSnoozedUntil: null,
      },
    });
    await prisma.adminSettings.update({
      where: { id: adminSettingsId },
      data: {
        publicUrl: PUBLIC_URL,
        frontendUrl: null,
        internetEnabled: true,
        publicUrlCheckedAt: null,
        publicUrlCheckOk: null,
        publicUrlCheckedUrl: null,
      },
    });
  });

  afterEach(() => fetchSpy.mockRestore());

  afterAll(async () => {
    await prisma.readinessItemState.deleteMany({});
    await prisma.readinessNoteAck.deleteMany({});
    await prisma.backup.deleteMany({});
    if (original) {
      await prisma.adminSettings.update({
        where: { id: adminSettingsId },
        data: {
          ...original,
          publicUrlCheckedAt: null,
          publicUrlCheckOk: null,
          publicUrlCheckedUrl: null,
        },
      });
    }
    await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
  });

  describe("invitation", () => {
    it("shows a new update note as reason update, and not again once seen", async () => {
      const first = await view(userCookie);
      expect(first.invitation).toMatchObject({ show: true, reason: "update", snoozedUntil: null });
      expect(
        (await request(app).post("/api/v1/readiness/invitation/seen").set("Cookie", userCookie))
          .status
      ).toBe(204);
      expect((await view(userCookie)).invitation.show).toBe(false);
    });

    it("shows again for a note that is new after the seen set was stored", async () => {
      await prisma.user.update({
        where: { id: adminId },
        data: { readinessInvitationSeen: ["2.8.0.settingsRemoved"] },
      });
      const v = await view(adminCookie);
      expect(v.notes.filter((n) => n.open).length).toBeGreaterThan(1);
      expect(v.invitation.show).toBe(true);
    });

    it("an item id that is no key is never added to the seen set", async () => {
      await request(app).post("/api/v1/readiness/invitation/seen").set("Cookie", adminCookie);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: adminId } });
      // unknown and recommended items are not keys; every stored key is an open note or a required item
      const v = await view(adminCookie);
      const keys = new Set([
        ...v.notes.filter((n) => n.open).map((n) => n.id),
        ...v.banner.itemIds,
      ]);
      expect(new Set(row.readinessInvitationSeen)).toEqual(keys);
      for (const k of row.readinessInvitationSeen) {
        expect(v.items.find((i) => i.id === k && i.status === "unknown")).toBeUndefined();
      }
    });

    it("hides the card while snoozed and reports the end of the snooze", async () => {
      const res = await request(app)
        .post("/api/v1/readiness/invitation/snooze")
        .set("Cookie", userCookie);
      expect(res.status).toBe(204);
      const v = await view(userCookie);
      expect(v.invitation.show).toBe(false);
      expect(v.invitation.reason).toBeNull();
      const until = new Date(v.invitation.snoozedUntil!).getTime() - Date.now();
      expect(until).toBeGreaterThan(23 * 3_600_000);
      expect(until).toBeLessThanOrEqual(24 * 3_600_000);
    });

    it("shows again once the snooze has run out", async () => {
      await prisma.user.update({
        where: { id: userId },
        data: { readinessInvitationSnoozedUntil: new Date(Date.now() - 1000) },
      });
      const v = await view(userCookie);
      expect(v.invitation).toMatchObject({ show: true, snoozedUntil: null });
    });

    it("an update note wins over a required item as the reason", async () => {
      await prisma.backup.create({
        data: { scheduled: true, status: "failed", backupPath: "/x" },
      });
      const v = await view(adminCookie);
      expect(v.banner.itemIds).toContain("admin.backup");
      expect(v.invitation.reason).toBe("update");
    });

    it("reports reason required when nothing but a required item is new", async () => {
      await prisma.user.update({
        where: { id: adminId },
        data: { readinessAckVersion: appVersion },
      });
      await prisma.backup.create({
        data: { scheduled: true, status: "failed", backupPath: "/x" },
      });
      expect((await view(adminCookie)).invitation).toMatchObject({
        show: true,
        reason: "required",
      });
      await request(app).post("/api/v1/readiness/invitation/seen").set("Cookie", adminCookie);
      expect((await view(adminCookie)).invitation.show).toBe(false);
    });

    it("a seen item that resolved and fails again shows the card again", async () => {
      await prisma.user.update({
        where: { id: adminId },
        data: { readinessAckVersion: appVersion },
      });
      await prisma.backup.create({
        data: { scheduled: true, status: "failed", backupPath: "/x" },
      });
      await request(app).post("/api/v1/readiness/invitation/seen").set("Cookie", adminCookie);
      expect((await view(adminCookie)).invitation.show).toBe(false);
      // it resolves, the page is opened once (the stale key is dropped), then it fails again
      await prisma.backup.deleteMany({});
      expect((await view(adminCookie)).invitation.keys).toEqual([]);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: adminId } });
      expect(row.readinessInvitationSeen).toEqual([]);
      await prisma.backup.create({
        data: { scheduled: true, status: "failed", backupPath: "/x" },
      });
      expect((await view(adminCookie)).invitation).toMatchObject({
        show: true,
        reason: "required",
      });
    });

    it("a key added between the GET and the seen POST stays unseen", async () => {
      await prisma.user.update({
        where: { id: adminId },
        data: { readinessAckVersion: appVersion },
      });
      const rendered = (await view(adminCookie)).invitation.keys;
      expect(rendered).toEqual([]);
      await prisma.backup.create({
        data: { scheduled: true, status: "failed", backupPath: "/x" },
      });
      const res = await request(app)
        .post("/api/v1/readiness/invitation/seen")
        .set("Cookie", adminCookie)
        .send({ keys: rendered });
      expect(res.status).toBe(204);
      expect((await view(adminCookie)).invitation.show).toBe(true);
    });

    it("seen with keys stores the rendered ones that are current and ignores the rest", async () => {
      const v = await view(userCookie);
      expect(v.invitation.keys.length).toBeGreaterThan(0);
      await request(app)
        .post("/api/v1/readiness/invitation/seen")
        .set("Cookie", userCookie)
        .send({ keys: [...v.invitation.keys, "no.such.key"] })
        .expect(204);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(new Set(row.readinessInvitationSeen)).toEqual(new Set(v.invitation.keys));
    });

    it("seen answers 400 for a bad body", async () => {
      for (const body of [
        { keys: "x" },
        { keys: [1] },
        { keys: Array.from({ length: 101 }, (_, i) => `k${i}`) },
      ]) {
        const res = await request(app)
          .post("/api/v1/readiness/invitation/seen")
          .set("Cookie", userCookie)
          .send(body);
        expect(res.status).toBe(400);
      }
    });

    it("an unknown item never makes a key", async () => {
      await prisma.user.update({
        where: { id: adminId },
        data: { readinessAckVersion: appVersion },
      });
      // no backup stored at all: admin.backup reads unknown
      const v = await view(adminCookie);
      expect(v.items.find((i) => i.id === "admin.backup")?.status).toBe("unknown");
      expect(v.banner.itemIds).not.toContain("admin.backup");
      expect(v.invitation.show).toBe(false);
    });

    it("refuses both writes for the demo account", async () => {
      for (const p of ["seen", "snooze"]) {
        const res = await request(app)
          .post(`/api/v1/readiness/invitation/${p}`)
          .set("Cookie", demoCookie);
        expect(res.status).toBe(403);
      }
    });
  });

  describe("banner", () => {
    beforeEach(async () => {
      await prisma.backup.create({
        data: { scheduled: true, status: "failed", backupPath: "/x" },
      });
    });

    it("is false for an ordinary account whatever the instance's state", async () => {
      expect((await view(userCookie)).banner).toEqual({ show: false, itemIds: [] });
    });

    it("is false for an admin's write token, which sees what an ordinary account sees", async () => {
      const tok = await generateApiToken();
      await prisma.apiToken.create({
        data: {
          userId: adminId,
          label: "rdy2-write",
          lookupHash: tok.lookupHash,
          hash: tok.hash,
          scope: "write",
        },
      });
      const res = await request(app)
        .get("/api/v1/readiness")
        .set("Authorization", `Bearer ${tok.plaintext}`);
      await prisma.apiToken.deleteMany({ where: { label: "rdy2-write" } });
      expect(res.body.banner).toEqual({ show: false, itemIds: [] });
    });

    it("names a verified required admin item", async () => {
      expect((await view(adminCookie)).banner).toEqual({ show: true, itemIds: ["admin.backup"] });
    });

    it("ignores a snooze of the item", async () => {
      await request(app)
        .post("/api/v1/readiness/items/admin.backup/snooze")
        .set("Cookie", adminCookie);
      const v = await view(adminCookie);
      expect(v.banner.itemIds).toContain("admin.backup");
      // ...while the invitation does drop the snoozed item as a key
      await prisma.user.update({
        where: { id: adminId },
        data: { readinessAckVersion: appVersion },
      });
      expect((await view(adminCookie)).invitation.show).toBe(false);
    });

    it("is false while the only required item is unknown", async () => {
      await prisma.backup.deleteMany({});
      expect((await view(adminCookie)).banner.show).toBe(false);
    });
  });

  describe("POST /admin/public-url/check", () => {
    const check = (cookie = adminCookie) =>
      request(app).post("/api/v1/admin/public-url/check").set("Cookie", cookie);

    it("needs an admin", async () => {
      expect((await check(userCookie)).status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("stores ok for a 2xx that echoes the nonce, and the item reads ready", async () => {
      stubHealth({});
      const res = await check();
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        ok: true,
        url: PUBLIC_URL,
        httpStatus: 200,
        errorCode: null,
      });
      const [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toMatch(/^https:\/\/trav\.example\.test\/health\?probe=[0-9a-f]{32}$/);
      expect(init.redirect).toBe("manual");
      expect(await stored()).toMatchObject({
        publicUrlCheckOk: true,
        publicUrlCheckedUrl: PUBLIC_URL,
      });
      const item = (await view(adminCookie)).items.find((i) => i.id === "admin.publicUrl");
      expect(item?.status).toBe("ready");
    });

    it("answers NOT_THIS_INSTANCE when the same version answers without the nonce", async () => {
      stubHealth({ echo: false, body: { version: appVersion } });
      const res = await check();
      expect(res.body).toMatchObject({
        ok: false,
        errorCode: "NOT_THIS_INSTANCE",
        httpStatus: 200,
      });
      expect(await stored()).toMatchObject({ publicUrlCheckOk: false });
      const v = await view(adminCookie);
      expect(v.items.find((i) => i.id === "admin.publicUrl")?.status).toBe("needsAction");
      expect(v.banner.itemIds).toContain("admin.publicUrl");
    });

    it("answers NOT_THIS_INSTANCE for a 2xx that is not JSON", async () => {
      fetchSpy.mockResolvedValue(new Response("<html>hi</html>", { status: 200 }));
      expect((await check()).body.errorCode).toBe("NOT_THIS_INSTANCE");
    });

    it("answers HTTP_STATUS for a 502, a redirect and a degraded instance", async () => {
      fetchSpy.mockResolvedValue(new Response("bad gateway", { status: 502 }));
      expect((await check()).body).toMatchObject({ errorCode: "HTTP_STATUS", httpStatus: 502 });
      fetchSpy.mockResolvedValue(new Response(null, { status: 301, headers: { location: "/x" } }));
      expect((await check()).body).toMatchObject({ errorCode: "HTTP_STATUS", httpStatus: 301 });
      stubHealth({ body: { status: "degraded" } });
      expect((await check()).body).toMatchObject({
        ok: false,
        errorCode: "HTTP_STATUS",
        httpStatus: 200,
      });
    });

    it.each([
      ["a timeout", Object.assign(new Error("t"), { name: "TimeoutError" }), "TIMEOUT"],
      [
        "a connect timeout",
        Object.assign(new TypeError("f"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }),
        "TIMEOUT",
      ],
      [
        "an unknown host",
        Object.assign(new TypeError("f"), { cause: { code: "ENOTFOUND" } }),
        "DNS",
      ],
      [
        "a bad certificate",
        Object.assign(new TypeError("f"), { cause: { code: "CERT_HAS_EXPIRED" } }),
        "TLS",
      ],
      [
        "a self-signed certificate",
        Object.assign(new TypeError("f"), { cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" } }),
        "TLS",
      ],
      [
        "a refused connection",
        Object.assign(new TypeError("f"), { cause: { code: "ECONNREFUSED" } }),
        "CONNECTION",
      ],
      ["an unclassified failure", new TypeError("fetch failed"), "CONNECTION"],
    ])("answers %s with its own errorCode", async (_label, error, code) => {
      fetchSpy.mockRejectedValue(error);
      const res = await check();
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        ok: false,
        errorCode: code,
        httpStatus: null,
        url: PUBLIC_URL,
      });
      expect(await stored()).toMatchObject({
        publicUrlCheckOk: false,
        publicUrlCheckedUrl: PUBLIC_URL,
      });
    });

    it("probes the address the Server page edits (frontendUrl) when public_url is null", async () => {
      await prisma.adminSettings.update({
        where: { id: adminSettingsId },
        data: { publicUrl: null, frontendUrl: PUBLIC_URL },
      });
      stubHealth({});
      const res = await check();
      expect(res.body).toMatchObject({ ok: true, url: PUBLIC_URL, errorCode: null });
      expect(await stored()).toMatchObject({ publicUrlCheckedUrl: PUBLIC_URL });
      const item = (await view(adminCookie)).items.find((i) => i.id === "admin.publicUrl");
      expect(item?.status).toBe("ready");
    });

    it("a stored result reads unknown once the Server page's address changes", async () => {
      await prisma.adminSettings.update({
        where: { id: adminSettingsId },
        data: { frontendUrl: PUBLIC_URL },
      });
      stubHealth({});
      await check();
      await prisma.adminSettings.update({
        where: { id: adminSettingsId },
        data: { frontendUrl: "https://other.example.test" },
      });
      const item = (await view(adminCookie)).items.find((i) => i.id === "admin.publicUrl");
      expect(item?.status).toBe("unknown");
    });

    it("answers NO_PUBLIC_URL without a request and stores nothing", async () => {
      await prisma.adminSettings.update({
        where: { id: adminSettingsId },
        data: { publicUrl: null, frontendUrl: null },
      });
      const res = await check();
      expect(res.body).toMatchObject({
        ok: false,
        url: null,
        httpStatus: null,
        errorCode: "NO_PUBLIC_URL",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((await stored()).publicUrlCheckedAt).toBeNull();
    });

    it("answers OUTBOUND_DISABLED under the master switch without a request and stores nothing", async () => {
      await prisma.adminSettings.update({
        where: { id: adminSettingsId },
        data: { internetEnabled: false },
      });
      const res = await check();
      expect(res.body).toMatchObject({
        ok: false,
        errorCode: "OUTBOUND_DISABLED",
        httpStatus: null,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((await stored()).publicUrlCheckedAt).toBeNull();
      const item = (await view(adminCookie)).items.find((i) => i.id === "admin.publicUrl");
      expect(item?.status).toBe("unknown");
    });

    it("a result stored for another URL reads unknown", async () => {
      stubHealth({});
      await check();
      await prisma.adminSettings.update({
        where: { id: adminSettingsId },
        data: { publicUrl: "https://other.example.test" },
      });
      const item = (await view(adminCookie)).items.find((i) => i.id === "admin.publicUrl");
      expect(item?.status).toBe("unknown");
    });

    it("a nonce works once", async () => {
      let seen = "";
      fetchSpy.mockImplementation(async (input: unknown) => {
        seen = new URL(String(input)).searchParams.get("probe")!;
        return new Response(JSON.stringify({ status: "ok", probe: seen }), { status: 200 });
      });
      await check();
      // after the probe the nonce is spent: /health no longer echoes it
      const res = await request(app).get(`/health?probe=${seen}`);
      expect(res.body.probe).toBeUndefined();
    });
  });

  describe("/health nonce", () => {
    it("keeps its existing fields and adds no probe without a held nonce", async () => {
      const res = await request(app).get("/health?probe=" + "a".repeat(32));
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(
        ["checks", "scheduler", "status", "timestamp", "version"].sort()
      );
      expect((await request(app).get("/health")).body.probe).toBeUndefined();
    });
  });

  describe("daily job", () => {
    it("probes and stores when a URL is set", async () => {
      stubHealth({});
      await runPublicUrlCheckJob();
      expect(await stored()).toMatchObject({ publicUrlCheckOk: true });
    });

    it("stays silent and stores nothing under the master switch", async () => {
      await prisma.adminSettings.update({
        where: { id: adminSettingsId },
        data: { internetEnabled: false },
      });
      await runPublicUrlCheckJob();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((await stored()).publicUrlCheckedAt).toBeNull();
    });
  });
});
