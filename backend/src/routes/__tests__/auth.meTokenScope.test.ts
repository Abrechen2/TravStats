import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";

/**
 * travstats-mcp refuses an admin token at start-up, so GET /auth/me has to say
 * which scope the calling token carries. A cookie session has no token: null.
 */
const USERNAME = "authMeTokenScope";

async function createPat(userId: string, scope: "read" | "write" | "admin"): Promise<string> {
  const tok = await generateApiToken();
  await prisma.apiToken.create({
    data: { userId, label: `me-scope-${scope}`, lookupHash: tok.lookupHash, hash: tok.hash, scope },
  });
  return tok.plaintext;
}

describe("GET /auth/me reports the token's scope", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123"), isAdmin: true },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
  });

  it.each(["read", "write", "admin"] as const)("names the %s scope of a token", async (scope) => {
    const pat = await createPat(userId, scope);
    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${pat}`);
    expect(res.status).toBe(200);
    expect(res.body.tokenScope).toBe(scope);
    expect(res.body.user.username).toBe(USERNAME);
  });

  it("answers null for a browser session", async () => {
    const cookie = `auth_token=${generateToken(userId)}`;
    const res = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.tokenScope).toBeNull();
  });
});
