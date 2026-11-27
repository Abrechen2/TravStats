import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateApiToken } from "../../utils/apiTokens";
import { generateToken } from "../../utils/jwt";

/**
 * The parse routes spend the server's OCR and language model. A read-scoped personal access token
 * must not be able to start that work (it could loop an assistant's budget away); a write token and a
 * browser session can.
 */
const USERNAME = "parsePatScopeUser";
const ROUTES: Array<[string, string]> = [
  ["post", "/api/v1/parse-email"],
  ["post", "/api/v1/parse-pdf"],
  ["post", "/api/v1/parse-image"],
  ["post", "/api/v1/parse-boardingpass"],
  ["post", "/api/v1/boardingpass/propose"],
  ["post", "/api/v1/parse-email-file"],
];

describe("parse routes and token scope", () => {
  let userId: string;
  let readToken: string;
  let writeToken: string;

  async function pat(scope: "read" | "write"): Promise<string> {
    const t = await generateApiToken();
    await prisma.apiToken.create({
      data: { userId, label: scope, lookupHash: t.lookupHash, hash: t.hash, scope },
    });
    return t.plaintext;
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    userId = (
      await prisma.user.create({
        data: { username: USERNAME, passwordHash: await hashPassword("password123") },
      })
    ).id;
    readToken = await pat("read");
    writeToken = await pat("write");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
  });

  for (const [, path] of ROUTES) {
    it(`${path}: a read token is refused with 403, a write token and a session get past the scope check`, async () => {
      const send = (auth: (r: request.Test) => request.Test) =>
        auth(request(app).post(path).send({ emailContent: "x" }));
      const read = await send((r) => r.set("Authorization", `Bearer ${readToken}`));
      expect(read.status).toBe(403);
      const write = await send((r) => r.set("Authorization", `Bearer ${writeToken}`));
      expect([401, 403]).not.toContain(write.status);
      const session = await send((r) => r.set("Cookie", `auth_token=${generateToken(userId)}`));
      expect([401, 403]).not.toContain(session.status);
    });
  }

  it("a write token reads a booking text (200)", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Authorization", `Bearer ${writeToken}`)
      .send({ emailContent: "Ihre Buchung LH400", domain: "flight" });
    expect(res.status).toBe(200);
  });
});
