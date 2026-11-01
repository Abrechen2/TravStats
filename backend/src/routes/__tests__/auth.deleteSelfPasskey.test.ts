import request from "supertest";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

jest.mock("@simplewebauthn/server", () => ({
  ...jest.requireActual("@simplewebauthn/server"),
  verifyAuthenticationResponse: jest.fn(),
}));
const verify = verifyAuthenticationResponse as jest.Mock;

const NAMES = ["delPk", "delPkOther"];

async function makeUser(username: string, credentialId?: string): Promise<string> {
  await prisma.user.deleteMany({ where: { username } });
  const user = await prisma.user.create({
    data: { username, passwordHash: await hashPassword("random-unknown-1234") },
  });
  if (credentialId) {
    await prisma.webAuthnCredential.create({
      data: {
        userId: user.id,
        credentialId,
        publicKey: Buffer.from("k").toString("base64url"),
        counter: 0n,
        transports: [],
        name: "Key",
        rpId: "trav.example.com",
      },
    });
  }
  return user.id;
}

const cookie = (id: string): string => `auth_token=${generateToken(id)}`;
const options = (id: string): request.Test =>
  request(app).post("/api/v1/auth/passkeys/reauth/options").set("Cookie", cookie(id));
const del = (id: string, body: Record<string, unknown>): request.Test =>
  request(app).delete("/api/v1/auth/me").set("Cookie", cookie(id)).send(body);

describe("deleting one's own account with a passkey instead of the password", () => {
  beforeAll(async () => {
    const row = await prisma.adminSettings.findFirst({ select: { id: true } });
    const data = {
      webauthnOrigins: ["https://trav.example.com"],
      webauthnRpId: null,
      publicUrl: null,
    };
    if (row) await prisma.adminSettings.update({ where: { id: row.id }, data });
    else await prisma.adminSettings.create({ data });
  });
  beforeEach(() => verify.mockReset());
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
  });

  it("deletes the account for a verified assertion, with no password sent", async () => {
    const id = await makeUser("delPk", "cred-own");
    const challenge = await options(id);
    expect(challenge.status).toBe(200);
    expect(challenge.body.allowCredentials).toEqual([expect.objectContaining({ id: "cred-own" })]);
    expect(challenge.body.userVerification).toBe("required");
    verify.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 1 } });
    const res = await del(id, { passkeyResponse: { id: "cred-own" }, confirmation: "LÖSCHEN" });
    expect(res.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
    expect(verify.mock.calls[0][0].requireUserVerification).toBe(true);
  });

  it("refuses with 403 DELETE_PASSKEY_INVALID when the assertion does not verify, and keeps the account", async () => {
    const id = await makeUser("delPk", "cred-own");
    await options(id);
    verify.mockResolvedValue({ verified: false, authenticationInfo: { newCounter: 1 } });
    const res = await del(id, { passkeyResponse: { id: "cred-own" }, confirmation: "DELETE" });
    expect(res.status).toBe(403);
    expect(res.body.code ?? res.body.errorCode).toBe("DELETE_PASSKEY_INVALID");
    expect(await prisma.user.findUnique({ where: { id } })).not.toBeNull();
  });

  it("refuses when the library throws, with no challenge issued, or for another user's credential", async () => {
    const id = await makeUser("delPk", "cred-own");
    const other = await makeUser("delPkOther", "cred-other");
    // no challenge issued yet
    expect(
      (await del(id, { passkeyResponse: { id: "cred-own" }, confirmation: "DELETE" })).status
    ).toBe(403);
    await options(id);
    verify.mockRejectedValue(new Error("bad signature"));
    expect(
      (await del(id, { passkeyResponse: { id: "cred-own" }, confirmation: "DELETE" })).status
    ).toBe(403);
    await options(id);
    verify.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 1 } });
    const foreign = await del(id, {
      passkeyResponse: { id: "cred-other" },
      confirmation: "DELETE",
    });
    expect(foreign.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { id: other } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id } })).not.toBeNull();
  });

  it("refuses a regressed counter, and a challenge answers one attempt only", async () => {
    const id = await makeUser("delPk", "cred-own");
    await prisma.webAuthnCredential.updateMany({ where: { userId: id }, data: { counter: 5n } });
    await options(id);
    verify.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 3 } });
    expect(
      (await del(id, { passkeyResponse: { id: "cred-own" }, confirmation: "DELETE" })).status
    ).toBe(403);
    verify.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 9 } });
    // challenge was consumed by the first attempt
    expect(
      (await del(id, { passkeyResponse: { id: "cred-own" }, confirmation: "DELETE" })).status
    ).toBe(403);
  });

  it("offers no challenge to an account without a passkey (409 NO_PASSKEY) and refuses both credentials at once", async () => {
    const id = await makeUser("delPk");
    const res = await options(id);
    expect(res.status).toBe(409);
    expect(res.body.code ?? res.body.errorCode).toBe("NO_PASSKEY");
    const both = await del(id, {
      password: "random-unknown-1234",
      passkeyResponse: { id: "x" },
      confirmation: "DELETE",
    });
    expect(both.status).toBe(400);
  });

  it("still demands the typed word with a valid assertion", async () => {
    const id = await makeUser("delPk", "cred-own");
    await options(id);
    verify.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 1 } });
    const res = await del(id, { passkeyResponse: { id: "cred-own" }, confirmation: "nope" });
    expect(res.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { id } })).not.toBeNull();
  });
});
