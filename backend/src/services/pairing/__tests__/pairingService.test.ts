import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { tokenLookupHash } from "../../../utils/apiTokens";
import {
  PAIRING_CODE_PREFIX,
  PAIRING_CODE_TTL_MS,
  generatePairingCode,
  getPairingStatus,
  verifyAndConsume,
} from "../pairingService";

describe("pairingService", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "pairingsvc" } });
    const u = await prisma.user.create({
      data: { username: "pairingsvc", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
  });

  beforeEach(async () => {
    await prisma.pairingCode.deleteMany({ where: { userId } });
    await prisma.apiToken.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.pairingCode.deleteMany({ where: { userId } });
    await prisma.apiToken.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("generatePairingCode", () => {
    it("creates a row and returns a prefixed plaintext + ~10min expiry", async () => {
      const before = Date.now();
      const { code, expiresAt } = await generatePairingCode(userId);

      expect(code.startsWith(PAIRING_CODE_PREFIX)).toBe(true);
      // prefix + 32 hex chars
      expect(code).toHaveLength(PAIRING_CODE_PREFIX.length + 32);

      const ttl = expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan(PAIRING_CODE_TTL_MS - 5_000);
      expect(ttl).toBeLessThanOrEqual(PAIRING_CODE_TTL_MS + 5_000);

      // Only the SHA-256 is persisted — never the plaintext.
      const row = await prisma.pairingCode.findUnique({
        where: { codeHash: tokenLookupHash(code) },
      });
      expect(row).not.toBeNull();
      expect(row?.userId).toBe(userId);
      expect(row?.consumedAt).toBeNull();
    });
  });

  describe("verifyAndConsume", () => {
    it("happy path: consumes a fresh code and returns the userId", async () => {
      const { code } = await generatePairingCode(userId);
      const result = await verifyAndConsume(code);
      expect(result).toBe(userId);

      const row = await prisma.pairingCode.findUnique({
        where: { codeHash: tokenLookupHash(code) },
      });
      expect(row?.consumedAt).not.toBeNull();
    });

    it("returns null for an expired code", async () => {
      const code = `${PAIRING_CODE_PREFIX}${"a".repeat(32)}`;
      await prisma.pairingCode.create({
        data: {
          codeHash: tokenLookupHash(code),
          userId,
          expiresAt: new Date(Date.now() - 1_000),
        },
      });
      expect(await verifyAndConsume(code)).toBeNull();
    });

    it("returns null for an already-consumed code", async () => {
      const { code } = await generatePairingCode(userId);
      expect(await verifyAndConsume(code)).toBe(userId);
      // Second claim must fail.
      expect(await verifyAndConsume(code)).toBeNull();
    });

    it("returns null for an unknown code", async () => {
      expect(await verifyAndConsume(`${PAIRING_CODE_PREFIX}${"f".repeat(32)}`)).toBeNull();
    });

    it("concurrent double-claim: exactly one wins", async () => {
      const { code } = await generatePairingCode(userId);
      const [a, b] = await Promise.all([verifyAndConsume(code), verifyAndConsume(code)]);
      const winners = [a, b].filter((r) => r === userId);
      const losers = [a, b].filter((r) => r === null);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
    });
  });

  describe("getPairingStatus", () => {
    it("reports not-found for an unknown code", async () => {
      const status = await getPairingStatus(`${PAIRING_CODE_PREFIX}${"0".repeat(32)}`, userId);
      expect(status).toEqual({ found: false, claimed: false });
    });

    it("reports unclaimed for a fresh code", async () => {
      const { code } = await generatePairingCode(userId);
      expect(await getPairingStatus(code, userId)).toEqual({ found: true, claimed: false });
    });

    it("reports not-found when the code is owned by another user", async () => {
      const { code } = await generatePairingCode(userId);
      const other = await prisma.user.create({
        data: { username: `pairingsvc-other-${Date.now()}`, passwordHash: await hashPassword("password123") },
      });
      try {
        expect(await getPairingStatus(code, other.id)).toEqual({ found: false, claimed: false });
      } finally {
        await prisma.user.delete({ where: { id: other.id } });
      }
    });

    it("reports claimed + deviceName once consumed and a device token exists", async () => {
      const { code } = await generatePairingCode(userId);
      await verifyAndConsume(code);
      await prisma.apiToken.create({
        data: {
          userId,
          label: "Pixel 8",
          lookupHash: tokenLookupHash(`tok-${Date.now()}`),
          hash: "x",
          scope: "write",
          deviceId: "device-abc",
        },
      });

      const status = await getPairingStatus(code, userId);
      expect(status.found).toBe(true);
      expect(status.claimed).toBe(true);
      expect(status.deviceName).toBe("Pixel 8");
    });
  });
});
