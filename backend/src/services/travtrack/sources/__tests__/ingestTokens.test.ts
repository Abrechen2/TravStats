import { prisma } from "../../../../db";
import { makeUser } from "../../__tests__/fixtures";
import {
  INGEST_TOKEN_PREFIX,
  MAX_INGEST_TOKENS,
  createIngestToken,
  ingestTokenDigestsWith,
  isKnownGoodIngestToken,
  listIngestTokens,
  looksLikeIngestToken,
  revokeIngestToken,
  verifyIngestToken,
} from "../ingestTokens";

/**
 * Per-device ingest tokens for OwnTracks and Overland (TravTrack plan E9). A
 * token is a secret: only keyed digests of it are stored, it is shown once,
 * it is bound to its app, and a revoked one is dead.
 */

const PREFIX = "tt-ingest-tokens-";

describe("ingest tokens", () => {
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
  });

  beforeEach(async () => {
    await prisma.travTrackIngestToken.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("stores only keyed digests: the token is nowhere in its row", async () => {
    const created = await createIngestToken(userId, { kind: "owntracks", label: "Pixel" });
    expect(created.token).toMatch(/^tt_ingest_[0-9a-f]{64}$/);
    expect(created.token.startsWith(INGEST_TOKEN_PREFIX)).toBe(true);
    const row = await prisma.travTrackIngestToken.findUniqueOrThrow({ where: { id: created.id } });
    const secret = created.token.slice(INGEST_TOKEN_PREFIX.length);
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(row.lookupHash).not.toBe(row.hash);
  });

  it("the digests depend on the server secret, not on the token alone", () => {
    const token = `${INGEST_TOKEN_PREFIX}${"a".repeat(64)}`;
    const one = ingestTokenDigestsWith("1".repeat(64), token);
    const two = ingestTokenDigestsWith("2".repeat(64), token);
    expect(one.lookupHash).not.toBe(two.lookupHash);
    expect(one.hash).not.toBe(two.hash);
  });

  it("a token verifies for its own kind only", async () => {
    const { id, token } = await createIngestToken(userId, { kind: "overland", label: "iPhone" });
    expect(await verifyIngestToken(token, "overland")).toEqual({
      tokenId: id,
      userId,
      kind: "overland",
    });
    expect(await verifyIngestToken(token, "owntracks")).toBeNull();
  });

  it("an unknown, malformed or revoked token does not verify", async () => {
    const { id, token } = await createIngestToken(userId, { kind: "owntracks", label: "Pixel" });
    expect(await verifyIngestToken(`${INGEST_TOKEN_PREFIX}${"0".repeat(64)}`, "owntracks")).toBe(
      null
    );
    expect(await verifyIngestToken("ts_pat_abc", "owntracks")).toBeNull();
    expect(looksLikeIngestToken(`${token}x`)).toBe(false);
    await revokeIngestToken(userId, id);
    expect(await verifyIngestToken(token, "owntracks")).toBeNull();
  });

  it("a deactivated account's token does not verify", async () => {
    const { token } = await createIngestToken(userId, { kind: "owntracks", label: "Pixel" });
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    try {
      expect(await verifyIngestToken(token, "owntracks")).toBeNull();
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
    }
  });

  it("lists without secrets, and revoking another account's token is not found", async () => {
    const { id } = await createIngestToken(userId, { kind: "owntracks", label: "Pixel" });
    const list = await listIngestTokens(userId);
    expect(list).toEqual([
      {
        id,
        kind: "owntracks",
        label: "Pixel",
        createdAt: expect.any(Date),
        lastUsedAt: null,
      },
    ]);
    await expect(revokeIngestToken(otherId, id)).rejects.toMatchObject({
      statusCode: 404,
      code: "INGEST_TOKEN_NOT_FOUND",
    });
    await revokeIngestToken(userId, id);
    expect(await listIngestTokens(userId)).toEqual([]);
    await expect(revokeIngestToken(userId, id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("an account holds at most MAX_INGEST_TOKENS live tokens", async () => {
    for (let i = 0; i < MAX_INGEST_TOKENS; i++) {
      await createIngestToken(userId, { kind: "owntracks", label: `Gerät ${i}` });
    }
    await expect(
      createIngestToken(userId, { kind: "owntracks", label: "one more" })
    ).rejects.toMatchObject({ statusCode: 409, code: "INGEST_TOKEN_LIMIT" });
  });

  it("a token that verified is known-good until it is revoked or fails", async () => {
    const { id, token } = await createIngestToken(userId, { kind: "owntracks", label: "Pixel" });
    expect(isKnownGoodIngestToken(token)).toBe(false);
    await verifyIngestToken(token, "owntracks");
    expect(isKnownGoodIngestToken(token)).toBe(true);
    await revokeIngestToken(userId, id);
    expect(isKnownGoodIngestToken(token)).toBe(false);

    const other = await createIngestToken(userId, { kind: "owntracks", label: "Pixel 2" });
    await verifyIngestToken(other.token, "owntracks");
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    try {
      expect(await verifyIngestToken(other.token, "owntracks")).toBeNull();
      expect(isKnownGoodIngestToken(other.token)).toBe(false);
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
    }
  });
});
