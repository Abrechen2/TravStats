import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateApiToken } from "../../utils/apiTokens";

/**
 * A Personal Access Token must not be able to change how the account is guarded.
 *
 * Two-factor and passkeys are not ordinary writes. They are the means of getting
 * in at all, so a token that could switch them on, rename them or delete them
 * could lock the owner out of every way back — and a token that leaked would
 * take the second factor with it. Device pairing and token management were
 * already browser-only for exactly this reason; these two routers were the ones
 * that had been missed (audit finding AUD-002), with no scope check of any kind:
 * a READ token was enough to set up and activate 2FA and to delete a passkey.
 *
 * The scope is checked too, and deliberately: `write` is refused here as firmly
 * as `read`. A write token may write travel data. It may not decide who gets in.
 */
async function createPat(userId: string, scope: "read" | "write" | "admin"): Promise<string> {
  const tok = await generateApiToken();
  await prisma.apiToken.create({
    data: {
      userId,
      label: `account-security-test-${scope}`,
      lookupHash: tok.lookupHash,
      hash: tok.hash,
      scope,
    },
  });
  return tok.plaintext;
}

const USERNAME = "accountSecurityBrowserOnly";

describe("account security is browser-only", () => {
  let userId: string;
  let readPat: string;
  let writePat: string;
  let adminPat: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    readPat = await createPat(userId, "read");
    writePat = await createPat(userId, "write");
    adminPat = await createPat(userId, "admin");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
  });

  // The single most damaging one: a read token that can arm a second factor.
  it.each([
    ["read", () => readPat],
    ["write", () => writePat],
    ["admin", () => adminPat],
  ])("refuses a %s token on two-factor setup", async (_scope, pat) => {
    const res = await request(app)
      .post("/api/v1/auth/2fa/setup")
      .set("Authorization", `Bearer ${pat()}`);

    expect(res.status).toBe(403);
    // No secret may be handed out on the way to that refusal.
    expect(res.body.otpauthUrl).toBeUndefined();
    expect(res.body.secret).toBeUndefined();

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.twoFactorPendingSecret).toBeNull();
  });

  it("refuses a read token on two-factor activation", async () => {
    const res = await request(app)
      .post("/api/v1/auth/2fa/activate")
      .set("Authorization", `Bearer ${readPat}`)
      .send({ code: "123456" });

    expect(res.status).toBe(403);
    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.twoFactorEnabledAt).toBeNull();
  });

  it("refuses a read token on passkey registration options", async () => {
    const res = await request(app)
      .post("/api/v1/auth/passkeys/register/options")
      .set("Authorization", `Bearer ${readPat}`);

    expect(res.status).toBe(403);
  });

  it("refuses a read token on deleting a passkey", async () => {
    const res = await request(app)
      .delete("/api/v1/auth/passkeys/some-credential-id")
      .set("Authorization", `Bearer ${readPat}`);

    // 403 for the wrong kind of credential, not 404 for the unknown id: the
    // refusal has to come before the route ever looks anything up.
    expect(res.status).toBe(403);
  });

  // AUD-012, the same class one floor down: a read token could add an airport to
  // the instance-wide catalogue, upload training material and change a suggested
  // journey. Not account security, but not "read" either.
  it("refuses a read token on ordinary writes it was never granted", async () => {
    const airport = await request(app)
      .post("/api/v1/airports")
      .set("Authorization", `Bearer ${readPat}`)
      .send({ iata: "ZZZ", name: "Audit Field", lat: 0, lon: 0 });
    expect(airport.status).toBe(403);

    const journey = await request(app)
      .patch("/api/v1/photo-journeys/does-not-exist")
      .set("Authorization", `Bearer ${readPat}`)
      .send({ state: "dismissed" });
    // 403 for the wrong credential, not 404 for the unknown id — the refusal
    // has to come before the handler looks anything up.
    expect(journey.status).toBe(403);

    // And reading is still reading.
    const list = await request(app)
      .get("/api/v1/photo-journeys")
      .set("Authorization", `Bearer ${readPat}`);
    expect(list.status).toBeLessThan(400);
  });

  // The guard must not have made the surface unreachable for its actual owner.
  it("still lets a browser session through", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: USERNAME, password: "password123" });
    const cookies = (login.headers["set-cookie"] as unknown as string[]) ?? [];

    const res = await request(app).post("/api/v1/auth/2fa/setup").set("Cookie", cookies);

    expect(res.status).toBe(200);
    expect(typeof res.body.otpauthUrl).toBe("string");
  });
});
