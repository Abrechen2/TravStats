import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { encryptSecret } from "../../services/twoFactor/totpService";
import { generateRecoveryCodes } from "../../services/twoFactor/recoveryCodeService";
import { disableTwoFactorForUsername } from "../../scripts/disableTwoFactor";

const SECRET = "JBSWY3DPEHPK3PXP";

async function makeUser(username: string, isAdmin = false): Promise<string> {
  await prisma.user.deleteMany({ where: { username } });
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword("password123"),
      isAdmin,
      twoFactorSecret: encryptSecret(SECRET),
      twoFactorEnabledAt: new Date(),
    },
  });
  await generateRecoveryCodes(user.id);
  return user.id;
}

describe("turning two-factor off", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["disableSelf", "disableAdmin", "disableVictim", "disableCli"] } },
    });
  });

  it("clears secret, flag and recovery codes when the password is right", async () => {
    const id = await makeUser("disableSelf");
    const res = await request(app)
      .post("/api/v1/auth/2fa/disable")
      .set("Cookie", `auth_token=${generateToken(id)}`)
      .send({ password: "password123" });

    expect(res.status).toBe(200);
    const row = await prisma.user.findUnique({ where: { id } });
    expect(row?.twoFactorSecret).toBeNull();
    expect(row?.twoFactorEnabledAt).toBeNull();
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: id } })).toBe(0);
  });

  it("refuses on a wrong password and leaves it enabled", async () => {
    const id = await makeUser("disableSelf");
    const res = await request(app)
      .post("/api/v1/auth/2fa/disable")
      .set("Cookie", `auth_token=${generateToken(id)}`)
      .send({ password: "wrong" });

    expect(res.status).toBe(401);
    const row = await prisma.user.findUnique({ where: { id } });
    expect(row?.twoFactorEnabledAt).not.toBeNull();
  });

  it("issues a fresh set of recovery codes against the password", async () => {
    const id = await makeUser("disableSelf");
    const res = await request(app)
      .post("/api/v1/auth/2fa/recovery-codes")
      .set("Cookie", `auth_token=${generateToken(id)}`)
      .send({ password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(10);
  });

  it("lets an admin clear it for somebody else", async () => {
    const adminId = await makeUser("disableAdmin", true);
    const victimId = await makeUser("disableVictim");

    const res = await request(app)
      .post(`/api/v1/admin/users/${victimId}/disable-2fa`)
      .set("Cookie", `auth_token=${generateToken(adminId)}`);

    expect(res.status).toBe(200);
    const row = await prisma.user.findUnique({ where: { id: victimId } });
    expect(row?.twoFactorEnabledAt).toBeNull();
  });

  it("does not let a normal user clear somebody else's", async () => {
    const plainId = await makeUser("disableSelf");
    const victimId = await makeUser("disableVictim");

    const res = await request(app)
      .post(`/api/v1/admin/users/${victimId}/disable-2fa`)
      .set("Cookie", `auth_token=${generateToken(plainId)}`);

    expect(res.status).toBe(403);
    const row = await prisma.user.findUnique({ where: { id: victimId } });
    expect(row?.twoFactorEnabledAt).not.toBeNull();
  });

  it("clears it from the command line by username", async () => {
    const id = await makeUser("disableCli");
    expect(await disableTwoFactorForUsername("disableCli")).toBe(true);

    const row = await prisma.user.findUnique({ where: { id } });
    expect(row?.twoFactorSecret).toBeNull();
    expect(row?.twoFactorEnabledAt).toBeNull();
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: id } })).toBe(0);
  });

  it("reports an unknown username instead of pretending it worked", async () => {
    expect(await disableTwoFactorForUsername("nobody-by-that-name")).toBe(false);
  });

  // The admin users list drives the reset-2FA action in the UI: without this
  // field the button cannot know when to appear.
  it("shows in the admin users list who has two-factor on", async () => {
    const adminId = await makeUser("disableAdmin", true);
    const res = await request(app)
      .get("/api/v1/admin/users")
      .set("Cookie", `auth_token=${generateToken(adminId)}`);

    expect(res.status).toBe(200);
    const row = res.body.users.find((u: { username: string }) => u.username === "disableAdmin");
    expect(row.twoFactorEnabledAt).not.toBeNull();
  });
});
