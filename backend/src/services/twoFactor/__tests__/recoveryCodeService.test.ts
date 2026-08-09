import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  consumeRecoveryCode,
  countUnusedRecoveryCodes,
} from "../recoveryCodeService";

describe("recoveryCodeService", () => {
  let userId: string;

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: "recoveryUser" } });
    const user = await prisma.user.create({
      data: { username: "recoveryUser", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "recoveryUser" } });
  });

  it("issues ten readable codes", async () => {
    const codes = await generateRecoveryCodes(userId);
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });

  it("stores hashes, never the codes themselves", async () => {
    const codes = await generateRecoveryCodes(userId);
    const rows = await prisma.twoFactorRecoveryCode.findMany({ where: { userId } });
    for (const row of rows) expect(codes).not.toContain(row.codeHash);
  });

  it("accepts a code once and never again", async () => {
    const codes = await generateRecoveryCodes(userId);
    expect(await consumeRecoveryCode(userId, codes[0])).toBe(true);
    expect(await consumeRecoveryCode(userId, codes[0])).toBe(false);
  });

  it("rejects a code belonging to somebody else", async () => {
    const codes = await generateRecoveryCodes(userId);
    const other = await prisma.user.create({
      data: { username: "recoveryOther", passwordHash: await hashPassword("password123") },
    });
    expect(await consumeRecoveryCode(other.id, codes[0])).toBe(false);
    await prisma.user.delete({ where: { id: other.id } });
  });

  it("counts what is left", async () => {
    const codes = await generateRecoveryCodes(userId);
    await consumeRecoveryCode(userId, codes[0]);
    expect(await countUnusedRecoveryCodes(userId)).toBe(RECOVERY_CODE_COUNT - 1);
  });

  // Regenerating is how a user reacts to a leaked sheet of codes. The old ones
  // must stop working the moment new ones are shown.
  it("replaces the whole set when regenerated", async () => {
    const first = await generateRecoveryCodes(userId);
    const second = await generateRecoveryCodes(userId);
    expect(await consumeRecoveryCode(userId, first[0])).toBe(false);
    expect(await consumeRecoveryCode(userId, second[0])).toBe(true);
  });

  it("ignores case and surrounding whitespace", async () => {
    const codes = await generateRecoveryCodes(userId);
    expect(await consumeRecoveryCode(userId, `  ${codes[0].toUpperCase()}  `)).toBe(true);
  });
});
