import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/** Point the instance at an origin, or clear it. */
async function setOrigin(origin: string | null, rpId?: string | null): Promise<void> {
  const row = await prisma.adminSettings.findFirst({ select: { id: true } });
  const data = {
    webauthnOrigins: origin ? [origin] : [],
    webauthnRpId: rpId ?? null,
    publicUrl: null,
  };
  if (row) {
    await prisma.adminSettings.update({ where: { id: row.id }, data });
  } else {
    await prisma.adminSettings.create({ data });
  }
}

describe("passkey endpoints", () => {
  let cookie: string;
  let userId: string;

  beforeEach(async () => {
    await prisma.webAuthnCredential.deleteMany({});
    await prisma.user.deleteMany({ where: { username: { in: ["passkeyUser", "passkeyVictim"] } } });
    const user = await prisma.user.create({
      data: { username: "passkeyUser", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    await setOrigin(null);
  });

  afterAll(async () => {
    await prisma.webAuthnCredential.deleteMany({});
    await prisma.user.deleteMany({ where: { username: { in: ["passkeyUser", "passkeyVictim"] } } });
    await setOrigin(null);
  });

  it("reports passkeys as unavailable when no origin is configured", async () => {
    const res = await request(app).get("/api/v1/auth/passkeys/availability");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, reason: "notConfigured" });
  });

  it("reports them unavailable on a plain-http LAN origin, with the reason", async () => {
    await setOrigin("http://192.168.1.10:3010");
    const res = await request(app).get("/api/v1/auth/passkeys/availability");
    expect(res.body).toEqual({ available: false, reason: "insecureOrigin" });
  });

  it("reports them available on https", async () => {
    await setOrigin("https://trav.example.com");
    const res = await request(app).get("/api/v1/auth/passkeys/availability");
    expect(res.body).toEqual({ available: true, reason: null });
  });

  it("refuses to hand out registration options when passkeys are unavailable", async () => {
    const res = await request(app)
      .post("/api/v1/auth/passkeys/register/options")
      .set("Cookie", cookie);
    expect(res.status).toBe(409);
  });

  it("hands out registration options carrying the configured rpId", async () => {
    await setOrigin("https://trav.example.com", "trav.example.com");
    const res = await request(app)
      .post("/api/v1/auth/passkeys/register/options")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.rp.id).toBe("trav.example.com");
    expect(res.body.challenge).toBeTruthy();
    expect(res.body.user.name).toBe("passkeyUser");
  });

  // The hinge of the whole design: a passkey stands in for BOTH the password
  // and the second factor, which is only honest if the authenticator actually
  // performed a local gesture. If this ever reads "preferred", the passkey
  // login below turns into a real 2FA bypass.
  it("demands user verification, never merely prefers it", async () => {
    await setOrigin("https://trav.example.com", "trav.example.com");
    const reg = await request(app)
      .post("/api/v1/auth/passkeys/register/options")
      .set("Cookie", cookie);
    expect(reg.body.authenticatorSelection.userVerification).toBe("required");

    const login = await request(app).post("/api/v1/auth/passkeys/login/options");
    expect(login.body.userVerification).toBe("required");
  });

  // Username-less sign-in only works if the server does NOT pin the credential
  // list — the authenticator has to be free to offer what it holds.
  it("asks for a discoverable credential at sign-in", async () => {
    await setOrigin("https://trav.example.com", "trav.example.com");
    const res = await request(app).post("/api/v1/auth/passkeys/login/options");
    expect(res.status).toBe(200);
    expect(res.body.allowCredentials ?? []).toEqual([]);
    expect(res.headers["set-cookie"].join(";")).toContain("passkey_handle=");
  });

  it("requires a session to register", async () => {
    await setOrigin("https://trav.example.com", "trav.example.com");
    expect((await request(app).post("/api/v1/auth/passkeys/register/options")).status).toBe(401);
    expect((await request(app).get("/api/v1/auth/passkeys")).status).toBe(401);
  });

  it("lists nothing for a user with no passkeys", async () => {
    const res = await request(app).get("/api/v1/auth/passkeys").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.passkeys).toEqual([]);
  });

  it("lists, renames and deletes a stored credential", async () => {
    const row = await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: "cred-1",
        publicKey: "cHVibGlj",
        name: "MacBook",
        rpId: "trav.example.com",
      },
    });

    const list = await request(app).get("/api/v1/auth/passkeys").set("Cookie", cookie);
    expect(list.body.passkeys).toHaveLength(1);
    expect(list.body.passkeys[0].name).toBe("MacBook");
    // The public key is not secret, but it has no business in a settings list.
    expect(list.body.passkeys[0].publicKey).toBeUndefined();

    const renamed = await request(app)
      .patch(`/api/v1/auth/passkeys/${row.id}`)
      .set("Cookie", cookie)
      .send({ name: "Bitwarden" });
    expect(renamed.status).toBe(200);
    expect(
      (await prisma.webAuthnCredential.findUnique({ where: { id: row.id } }))?.name
    ).toBe("Bitwarden");

    const del = await request(app)
      .delete(`/api/v1/auth/passkeys/${row.id}`)
      .set("Cookie", cookie);
    expect(del.status).toBe(200);
    expect(await prisma.webAuthnCredential.count({ where: { userId } })).toBe(0);
  });

  it("refuses to delete or rename somebody else's passkey", async () => {
    const victim = await prisma.user.create({
      data: { username: "passkeyVictim", passwordHash: await hashPassword("password123") },
    });
    const row = await prisma.webAuthnCredential.create({
      data: {
        userId: victim.id,
        credentialId: "cred-victim",
        publicKey: "cHVibGlj",
        name: "Their key",
        rpId: "trav.example.com",
      },
    });

    const del = await request(app)
      .delete(`/api/v1/auth/passkeys/${row.id}`)
      .set("Cookie", cookie);
    expect(del.status).toBe(404);

    const renamed = await request(app)
      .patch(`/api/v1/auth/passkeys/${row.id}`)
      .set("Cookie", cookie)
      .send({ name: "Mine now" });
    expect(renamed.status).toBe(404);

    const survivor = await prisma.webAuthnCredential.findUnique({ where: { id: row.id } });
    expect(survivor?.name).toBe("Their key");
  });

  it("refuses a sign-in with no challenge cookie", async () => {
    await setOrigin("https://trav.example.com", "trav.example.com");
    const res = await request(app)
      .post("/api/v1/auth/passkeys/login/verify")
      .send({ response: { id: "cred-1" } });
    expect(res.status).toBe(401);
  });

  it("refuses a sign-in for an unknown credential", async () => {
    await setOrigin("https://trav.example.com", "trav.example.com");
    const options = await request(app).post("/api/v1/auth/passkeys/login/options");
    const res = await request(app)
      .post("/api/v1/auth/passkeys/login/verify")
      .set("Cookie", options.headers["set-cookie"])
      .send({ response: { id: "nobody-has-this" } });
    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]?.join(";") ?? "").not.toContain("auth_token=");
  });

  // A bare IP cannot be an rpId, and accepting one would mint credentials the
  // browser refuses to use.
  it("treats a bare-IP rpId as no passkey support at all", async () => {
    await setOrigin("https://192.168.1.10:3010", "192.168.1.10");
    const res = await request(app)
      .post("/api/v1/auth/passkeys/register/options")
      .set("Cookie", cookie);
    expect(res.status).toBe(409);
  });
});
