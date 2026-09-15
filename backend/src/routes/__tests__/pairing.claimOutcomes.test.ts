import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { tokenLookupHash } from "../../utils/apiTokens";
import { generatePairingCode } from "../../services/pairing/pairingService";

/**
 * forgejo#115. All three ways a claim can miss answered "Invalid or expired
 * pairing code", and the one that mattered most was neither: on 2026-09-08
 * prod handed out QR codes carrying the RC server's address, so every claim
 * reached a server that had never minted the code. Told "expired", the user
 * waits for a new code — which fails identically, because the address is what
 * is wrong. It cost an afternoon to find.
 *
 * A file of its own rather than a block inside `pairing.test.ts`: the claim
 * route allows ten attempts per quarter hour and that file has already spent
 * most of them, so the assertions there came back 429 and proved nothing.
 */
describe("POST /pairing/claim — what the phone is told when a code does not work", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "pairingclaimoutcomes" } });
    const user = await prisma.user.create({
      data: { username: "pairingclaimoutcomes", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.pairingCode.deleteMany({ where: { userId } });
    await prisma.apiToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const claim = (code: string) =>
    request(app).post("/api/v1/pairing/claim").send({ code, deviceName: "Pixel 8" });

  it("points at the server address for a code this instance never minted", async () => {
    const res = await claim(`clm_${"f".repeat(32)}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different TravStats instance/i);
    expect(res.body.error).not.toMatch(/expired/i);
  });

  it("says expired for a code this instance issued and let lapse", async () => {
    const code = `clm_${"a".repeat(32)}`;
    await prisma.pairingCode.create({
      data: {
        codeHash: tokenLookupHash(code),
        userId,
        expiresAt: new Date(Date.now() - 1_000),
      },
    });

    const res = await claim(code);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
    expect(res.body.error).not.toMatch(/different TravStats instance/i);
  });

  it("says already used for a code that was spent", async () => {
    const { code } = await generatePairingCode(userId);
    await claim(code).expect(201);

    const res = await claim(code);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been used/i);
  });
});
