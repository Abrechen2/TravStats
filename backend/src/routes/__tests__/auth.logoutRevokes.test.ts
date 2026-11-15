import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#412 N4 — logout only cleared the cookie, so a copy of the session
 * JWT stayed valid until it expired. Logout now revokes that one token.
 */
const NAME = "logoutRevokeUser";
let userId: string;

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { username: NAME } });
  const u = await prisma.user.create({
    data: { username: NAME, passwordHash: await hashPassword("password12345") },
  });
  userId = u.id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: NAME } });
  await prisma.$disconnect();
});

const me = (token: string) =>
  request(app).get("/api/v1/auth/me").set("Cookie", `auth_token=${token}`);

describe("logout revokes the session token (forgejo#412 N4)", () => {
  it("replaying the old cookie after logout is a 401, while another session stays valid", async () => {
    const a = generateToken(userId);
    const b = generateToken(userId);
    expect((await me(a)).status).toBe(200);

    const out = await request(app).post("/api/v1/auth/logout").set("Cookie", `auth_token=${a}`);
    expect(out.status).toBe(200);

    expect((await me(a)).status).toBe(401);
    expect((await me(b)).status).toBe(200);
  });

  it("a token minted before the jti claim keeps working and logout does not fail on it", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const { JWT_SECRET } = await import("../../utils/jwtSecret");
    const legacy = jwt.sign({ userId, epoch: 0 }, JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "1d",
    });
    const out = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", `auth_token=${legacy}`);
    expect(out.status).toBe(200);
    expect((await me(legacy)).status).toBe(200);
  });

  it("logout without a cookie still answers 200", async () => {
    expect((await request(app).post("/api/v1/auth/logout")).status).toBe(200);
  });

  it("prunes revoked rows whose token has expired", async () => {
    await prisma.revokedSession.create({
      data: { jti: "old-jti", expiresAt: new Date(Date.now() - 1000) },
    });
    const t = generateToken(userId);
    await request(app).post("/api/v1/auth/logout").set("Cookie", `auth_token=${t}`);
    expect(await prisma.revokedSession.findUnique({ where: { jti: "old-jti" } })).toBeNull();
  });
});
