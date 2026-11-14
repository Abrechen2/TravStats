import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { appVersion } from "../../utils/version";
import { generateApiToken } from "../../utils/apiTokens";
import { resetDiskCache } from "../../services/readiness/context";

/**
 * `/api/v1/readiness` (setup & readiness, spec 2026-11-14 §11): the contract's
 * failure paths — an admin item hidden from an ordinary account, a required item
 * that refuses an opt-out, state stored for an older revision, a blocked item that
 * names no admin detail, a stale stored result reading `unknown`.
 */

const PATH = "/api/v1/readiness";
const NAMES = ["rdy_admin", "rdy_user", "demo"];

interface Item {
  id: string;
  status: string;
  action: string | null;
  blockedBy: string | null;
  userState: { kind: string; until?: string } | null;
  optOutAllowed: boolean;
  checkedAt: string | null;
}
interface Note {
  id: string;
  open: boolean;
  acknowledged: boolean;
}

describe("Readiness API", () => {
  let adminCookie: string;
  let userCookie: string;
  let demoCookie: string;
  let userId: string;
  let adminId: string;

  const itemsOf = async (cookie: string): Promise<Item[]> =>
    (await request(app).get(PATH).set("Cookie", cookie)).body.items as Item[];

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
  });

  beforeEach(async () => {
    resetDiskCache();
    await prisma.readinessItemState.deleteMany({});
    await prisma.readinessNoteAck.deleteMany({});
    await prisma.externalServiceTest.deleteMany({ where: { userId: null } });
    await prisma.smtpConfig.deleteMany({});
    await prisma.backup.deleteMany({});
    await prisma.reminderPreference.deleteMany({ where: { userId } });
    await prisma.user.update({
      where: { id: userId },
      data: { notificationEmail: null, readinessAckVersion: "2.7.0" },
    });
  });

  afterAll(async () => {
    await prisma.readinessItemState.deleteMany({});
    await prisma.readinessNoteAck.deleteMany({});
    await prisma.externalServiceTest.deleteMany({ where: { userId: null } });
    await prisma.smtpConfig.deleteMany({});
    await prisma.backup.deleteMany({});
    await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
  });

  it("needs a session", async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
  });

  it("answers every contract field, with admin items for an admin only", async () => {
    const res = await request(app).get(PATH).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["items", "notes", "runningVersion", "summary"]);
    expect(Object.keys(res.body.summary).sort()).toEqual([
      "blockedByAdmin",
      "newNotes",
      "ready",
      "recommended",
      "required",
      "unknown",
    ]);
    const ids = (res.body.items as Item[]).map((i) => i.id);
    expect(ids).toContain("admin.smtp");

    const own = (await itemsOf(userCookie)).map((i) => i.id);
    expect(own.some((id) => id.startsWith("admin."))).toBe(false);
  });

  it("answers 404 for an admin item to an ordinary account, like an unknown id", async () => {
    for (const verb of [
      request(app).post(`${PATH}/items/admin.smtp/snooze`).set("Cookie", userCookie).send({}),
      request(app).post(`${PATH}/items/admin.smtp/opt-out`).set("Cookie", userCookie),
      request(app).delete(`${PATH}/items/admin.smtp/state`).set("Cookie", userCookie),
      request(app).post(`${PATH}/items/no.such.item/snooze`).set("Cookie", userCookie).send({}),
    ]) {
      const res = await verb;
      expect(res.status).toBe(404);
    }
    // Nothing was stored by the refused writes.
    expect(await prisma.readinessItemState.count()).toBe(0);
  });

  it("refuses an opt-out on a required item with 409", async () => {
    const res = await request(app)
      .post(`${PATH}/items/admin.disk/opt-out`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("READINESS_OPT_OUT_NOT_ALLOWED");
    const disk = (await itemsOf(adminCookie)).find((i) => i.id === "admin.disk")!;
    expect(disk.optOutAllowed).toBe(false);
    expect(disk.userState).toBeNull();
  });

  it("opts out of a recommended item, and clears it again", async () => {
    const out = await request(app)
      .post(`${PATH}/items/admin.offsite/opt-out`)
      .set("Cookie", adminCookie);
    expect(out.status).toBe(204);
    expect((await itemsOf(adminCookie)).find((i) => i.id === "admin.offsite")!.userState).toEqual({
      kind: "optedOut",
    });
    const cleared = await request(app)
      .delete(`${PATH}/items/admin.offsite/state`)
      .set("Cookie", adminCookie);
    expect(cleared.status).toBe(204);
    expect(
      (await itemsOf(adminCookie)).find((i) => i.id === "admin.offsite")!.userState
    ).toBeNull();
  });

  it("snoozes for a day by default and refuses a snooze beyond 30 days or in the past", async () => {
    const ok = await request(app)
      .post(`${PATH}/items/admin.offsite/snooze`)
      .set("Cookie", adminCookie)
      .send({});
    expect(ok.status).toBe(204);
    const state = (await itemsOf(adminCookie)).find((i) => i.id === "admin.offsite")!.userState!;
    expect(state.kind).toBe("snoozed");
    const hours = (new Date(state.until!).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23);
    expect(hours).toBeLessThanOrEqual(24);

    const far = new Date(Date.now() + 31 * 86_400_000).toISOString();
    const past = new Date(Date.now() - 1000).toISOString();
    for (const until of [far, past, "not a date"]) {
      const res = await request(app)
        .post(`${PATH}/items/admin.offsite/snooze`)
        .set("Cookie", adminCookie)
        .send({ until });
      expect(res.status).toBe(400);
    }
  });

  it("ignores state stored for an older revision of the check", async () => {
    await prisma.readinessItemState.create({
      data: { userId: adminId, itemId: "admin.offsite", revision: 0, kind: "optedOut" },
    });
    expect(
      (await itemsOf(adminCookie)).find((i) => i.id === "admin.offsite")!.userState
    ).toBeNull();
    // Positive control: the same row at the current revision counts.
    await prisma.readinessItemState.update({
      where: { userId_itemId: { userId: adminId, itemId: "admin.offsite" } },
      data: { revision: 1 },
    });
    expect((await itemsOf(adminCookie)).find((i) => i.id === "admin.offsite")!.userState).toEqual({
      kind: "optedOut",
    });
  });

  it("blocks a user item behind a failing admin item without naming admin detail", async () => {
    await prisma.reminderPreference.create({
      data: { userId, domain: "flight", enabled: true, channel: "mail" },
    });
    const res = await request(app).get(PATH).set("Cookie", userCookie);
    const item = (res.body.items as Item[]).find((i) => i.id === "user.notificationEmail")!;
    expect(item.status).toBe("needsAction");
    expect(item.blockedBy).toBe("admin.smtp");
    expect(item.action).toBeNull();
    expect((res.body.items as Item[]).some((i) => i.id === "admin.smtp")).toBe(false);
    expect(res.body.summary.blockedByAdmin).toBe(1);
    // Blocked items are counted apart, not as something this account can do itself.
    const own = (res.body.items as Item[]).filter(
      (i) => i.status === "needsAction" && i.blockedBy === null && i.userState === null
    );
    expect(res.body.summary.recommended).toBe(own.length);

    // Once the admin item is ready the user item carries its own action again.
    await prisma.smtpConfig.create({
      data: { id: 1, host: "h", username: "u", password: "p", fromEmail: "a@b.c", enabled: true },
    });
    await prisma.externalServiceTest.create({
      data: { userId: null, serviceId: "smtp", ok: true, reason: null },
    });
    const after = (await itemsOf(userCookie)).find((i) => i.id === "user.notificationEmail")!;
    expect(after.blockedBy).toBeNull();
    expect(after.action).toBe("/settings/erinnerungen");
  });

  it("reads a stored result older than the check's limit as unknown", async () => {
    await prisma.smtpConfig.create({
      data: { id: 1, host: "h", username: "u", password: "p", fromEmail: "a@b.c", enabled: true },
    });
    const test = await prisma.externalServiceTest.create({
      data: { userId: null, serviceId: "smtp", ok: true, reason: null },
    });
    const smtp = async () => (await itemsOf(adminCookie)).find((i) => i.id === "admin.smtp")!;
    expect((await smtp()).status).toBe("ready");
    await prisma.externalServiceTest.update({
      where: { id: test.id },
      data: { at: new Date(Date.now() - 200 * 86_400_000) },
    });
    const stale = await smtp();
    expect(stale.status).toBe("unknown");
    expect(stale.checkedAt).not.toBeNull();
  });

  it("shows an admin's read or write token no admin item, and the admin scope does", async () => {
    const bearer = async (scope: "read" | "write" | "admin"): Promise<string> => {
      const tok = await generateApiToken();
      await prisma.apiToken.create({
        data: {
          userId: adminId,
          label: `rdy-${scope}`,
          lookupHash: tok.lookupHash,
          hash: tok.hash,
          scope,
        },
      });
      return `Bearer ${tok.plaintext}`;
    };
    const idsVia = async (auth: string): Promise<string[]> =>
      ((await request(app).get(PATH).set("Authorization", auth)).body.items as Item[]).map(
        (i) => i.id
      );
    expect((await idsVia(await bearer("write"))).some((id) => id.startsWith("admin."))).toBe(false);
    expect((await idsVia(await bearer("read"))).some((id) => id.startsWith("admin."))).toBe(false);
    expect(await idsVia(await bearer("admin"))).toContain("admin.smtp");
    await prisma.apiToken.deleteMany({ where: { userId: adminId, label: { startsWith: "rdy-" } } });
  });

  it("does not let one retested provider keep other expired results looking fresh", async () => {
    const at = (days: number) => new Date(Date.now() - days * 86_400_000);
    await prisma.externalServiceTest.createMany({
      data: [
        { userId: null, serviceId: "opensky", ok: true, at: at(200) },
        { userId: null, serviceId: "aeroapi", ok: true, at: at(0) },
      ],
    });
    const keys = (await itemsOf(adminCookie)).find((i) => i.id === "admin.providerKeys")!;
    expect(keys.status).toBe("unknown");
  });

  it("reports a missed scheduled backup as needing action and a recent one as ready", async () => {
    const backup = async () => (await itemsOf(adminCookie)).find((i) => i.id === "admin.backup")!;
    expect((await backup()).status).toBe("unknown");
    const row = await prisma.backup.create({
      data: {
        scheduled: true,
        status: "completed",
        backupPath: "/x",
        completedAt: new Date(Date.now() - 60 * 86_400_000),
      },
    });
    expect((await backup()).status).toBe("needsAction");
    await prisma.backup.update({ where: { id: row.id }, data: { completedAt: new Date() } });
    expect((await backup()).status).toBe("ready");
    await prisma.backup.update({ where: { id: row.id }, data: { status: "failed" } });
    expect((await backup()).status).toBe("needsAction");
  });

  describe("update notes", () => {
    const notesOf = async (cookie: string): Promise<Note[]> =>
      (await request(app).get(PATH).set("Cookie", cookie)).body.notes as Note[];

    it("lists the notes between the acknowledged version and the running one, by audience", async () => {
      const own = (await notesOf(userCookie)).map((n) => n.id);
      expect(own).toContain("2.8.0.friendsMerged");
      expect(own).not.toContain("2.8.0.backupsAlwaysOn");
      expect((await notesOf(adminCookie)).map((n) => n.id)).toContain("2.8.0.backupsAlwaysOn");
    });

    it("shows a new account at the running version no historical note", async () => {
      await prisma.user.update({
        where: { id: userId },
        data: { readinessAckVersion: appVersion },
      });
      expect(await notesOf(userCookie)).toEqual([]);
    });

    it("closes an informational note when acknowledged, but not a check-backed one", async () => {
      expect(
        (await request(app).post(`${PATH}/notes/2.8.0.friendsMerged/ack`).set("Cookie", userCookie))
          .status
      ).toBe(204);
      const info = (await notesOf(userCookie)).find((n) => n.id === "2.8.0.friendsMerged")!;
      expect(info).toMatchObject({ acknowledged: true, open: false });

      await request(app)
        .post(`${PATH}/notes/2.8.0.backupsAlwaysOn/ack`)
        .set("Cookie", adminCookie)
        .expect(204);
      const backed = (await notesOf(adminCookie)).find((n) => n.id === "2.8.0.backupsAlwaysOn")!;
      expect(backed).toMatchObject({ acknowledged: true, open: true });
    });

    it("answers 404 for an unknown note and for an admin note to an ordinary account", async () => {
      for (const id of ["nope", "2.8.0.backupsAlwaysOn"]) {
        const res = await request(app).post(`${PATH}/notes/${id}/ack`).set("Cookie", userCookie);
        expect(res.status).toBe(404);
      }
    });
  });

  it("lets the shared demo account read and refuses its writes", async () => {
    expect((await request(app).get(PATH).set("Cookie", demoCookie)).status).toBe(200);
    for (const res of [
      await request(app)
        .post(`${PATH}/items/admin.offsite/snooze`)
        .set("Cookie", demoCookie)
        .send({}),
      await request(app).post(`${PATH}/items/user.domains/opt-out`).set("Cookie", demoCookie),
      await request(app).delete(`${PATH}/items/user.domains/state`).set("Cookie", demoCookie),
      await request(app).post(`${PATH}/notes/2.8.0.friendsMerged/ack`).set("Cookie", demoCookie),
    ]) {
      expect(res.status).toBe(403);
    }
  });
});
