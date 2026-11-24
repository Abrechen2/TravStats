import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { encryptionKeyFingerprint } from "../../utils/encryption";

/**
 * "Einrichtung & Zustand" carries the recovery key as a red (required) admin
 * item (owner request 2026-11-24): an instance with an off-site backup target
 * whose key nobody confirmed — or confirmed for a key since replaced — has
 * backups whose credentials will not decrypt after the server is lost. This
 * reaches instances that had WebDAV before the confirmation existed.
 */

const PATH = "/api/v1/readiness";

interface Item {
  id: string;
  status: string;
  action: string | null;
}

describe("readiness: admin.recoveryKey", () => {
  let adminId: string;
  let userId: string;
  let adminCookie: string;
  let userCookie: string;
  let rowId: number;

  const item = async (cookie: string): Promise<Item | undefined> =>
    ((await request(app).get(PATH).set("Cookie", cookie)).body.items as Item[]).find(
      (i) => i.id === "admin.recoveryKey"
    );
  const setRow = (data: Parameters<typeof prisma.adminSettings.update>[0]["data"]) =>
    prisma.adminSettings.update({ where: { id: rowId }, data });

  beforeAll(async () => {
    const stamp = Date.now();
    const mk = async (username: string, isAdmin: boolean) =>
      prisma.user.create({
        data: { username, passwordHash: await hashPassword("pw-123456"), isAdmin, isActive: true },
      });
    adminId = (await mk(`rdy_rk_admin_${stamp}`, true)).id;
    userId = (await mk(`rdy_rk_user_${stamp}`, false)).id;
    adminCookie = `auth_token=${generateToken(adminId)}`;
    userCookie = `auth_token=${generateToken(userId)}`;
    const existing = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    rowId = existing ? existing.id : (await prisma.adminSettings.create({ data: {} })).id;
  });

  afterAll(async () => {
    await setRow({
      webdavSyncEnabled: false,
      webdavUrl: null,
      recoveryKeyConfirmedAt: null,
      recoveryKeyFingerprint: null,
    });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
  });

  it("is absent while there is no off-site backup target", async () => {
    await setRow({ webdavSyncEnabled: false, webdavUrl: null });
    expect(await item(adminCookie)).toBeUndefined();
  });

  it("needs action on an existing WebDAV instance whose key nobody confirmed", async () => {
    await setRow({
      webdavSyncEnabled: true,
      webdavUrl: "https://dav.example.test/",
      recoveryKeyConfirmedAt: null,
      recoveryKeyFingerprint: null,
    });
    const found = await item(adminCookie);
    expect(found).toMatchObject({ status: "needsAction", action: "/settings/sicherungen" });
    // Never shown to an ordinary account.
    expect(await item(userCookie)).toBeUndefined();
  });

  it("needs action again when the confirmation was for another key", async () => {
    await setRow({
      recoveryKeyConfirmedAt: new Date(),
      recoveryKeyFingerprint: "0000000000000000",
    });
    expect((await item(adminCookie))?.status).toBe("needsAction");
  });

  it("is ready once confirmed for the key in force", async () => {
    await setRow({
      recoveryKeyConfirmedAt: new Date(),
      recoveryKeyFingerprint: encryptionKeyFingerprint(),
    });
    expect((await item(adminCookie))?.status).toBe("ready");
  });
});
