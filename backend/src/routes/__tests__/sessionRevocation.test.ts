import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";

/**
 * Changing a password ends the sessions that were opened with the old one.
 *
 * The JWT carries a user id and an expiry and nothing else, so until 2026-09-09
 * a password change or a reset left every cookie already in circulation working
 * for up to seven more days. Recovering an account did not remove whoever you
 * were recovering it from — which is the one thing the recovery is for (audit
 * finding AUD-003).
 *
 * The cutoff is a timestamp on the user compared against the token's `iat`, so
 * these tests exercise the real thing end to end: a cookie taken before the
 * change, and the same route after it.
 */
const USERNAME = "sessionRevocation";
const OTHER = "sessionRevocationOther";

const cookiesOf = (res: request.Response): string[] =>
  (res.headers["set-cookie"] as unknown as string[]) ?? [];

async function makeUser(username: string, isAdmin = false): Promise<string> {
  await prisma.user.deleteMany({ where: { username } });
  const user = await prisma.user.create({
    data: { username, passwordHash: await hashPassword("password123"), isAdmin },
  });
  return user.id;
}

async function loginCookie(username: string, password = "password123"): Promise<string[]> {
  const res = await request(app).post("/api/v1/auth/login").send({ username, password });
  return cookiesOf(res);
}

describe("session revocation on password change", () => {
  let userId: string;

  beforeEach(async () => {
    userId = await makeUser(USERNAME);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [USERNAME, OTHER] } } });
  });

  it("closes a session opened before the password was changed", async () => {
    const stolen = await loginCookie(USERNAME);
    // The cookie works right up to the moment the password changes.
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", stolen)).status).toBe(200);

    const owner = await loginCookie(USERNAME);
    const change = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Cookie", owner)
      .send({ oldPassword: "password123", newPassword: "newPassword456" });
    expect(change.status).toBe(200);

    const after = await request(app).get("/api/v1/auth/me").set("Cookie", stolen);
    expect(after.status).toBe(401);
  });

  // Logging the owner out of their own password change would be a fix nobody
  // could live with, and the second-resolution `iat` makes it a real risk.
  it("keeps the session that performed the change", async () => {
    const owner = await loginCookie(USERNAME);

    const change = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Cookie", owner)
      .send({ oldPassword: "password123", newPassword: "newPassword456" });
    expect(change.status).toBe(200);

    // The response hands back a fresh cookie; that one must work.
    const refreshed = cookiesOf(change);
    expect(refreshed.join(";")).toContain("auth_token=");
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", refreshed)).status).toBe(200);
  });

  it("closes sessions when an administrator resets the password", async () => {
    const victim = await loginCookie(USERNAME);
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", victim)).status).toBe(200);

    await makeUser(OTHER, true);
    const adminCookie = await loginCookie(OTHER);

    const reset = await request(app)
      .post(`/api/v1/admin/users/${userId}/reset-password`)
      .set("Cookie", adminCookie)
      .send({ mode: "generate" });
    expect(reset.status).toBe(200);

    const after = await request(app).get("/api/v1/auth/me").set("Cookie", victim);
    expect(after.status).toBe(401);
  });

  it("leaves an untouched account alone", async () => {
    const cookie = await loginCookie(USERNAME);
    await makeUser(OTHER, true);
    const other = await loginCookie(OTHER);

    // Somebody else changing their password must not sign this user out.
    await request(app)
      .post("/api/v1/auth/change-password")
      .set("Cookie", other)
      .send({ oldPassword: "password123", newPassword: "newPassword456" });

    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(200);
  });
});
