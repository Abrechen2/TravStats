import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { deriveInstanceSecret, deriveSecretFrom } from "../../../utils/encryptionKey";

/**
 * Per-device ingest tokens for OwnTracks and Overland (TravTrack plan E9,
 * review focus 25). A token posts points for its owner and does nothing else:
 * it is not an `ApiToken`, `authenticate` does not know it, and no route but
 * the two ingest paths accepts it.
 *
 * The token is a secret and is shown exactly once. What is stored are two
 * HMAC-SHA256 digests under keys derived (HKDF) from the instance key, as the
 * evidence digests are (`locationEvidence/key.ts`):
 *
 *   - `lookup_hash` — uniquely indexed, finds the row in O(1);
 *   - `hash`        — under a second key, compared in constant time.
 *
 * Not bcrypt, unlike a PAT (`utils/apiTokens.ts`): a token is 256 random bits,
 * so an offline guess is hopeless at any speed, while a phone in move mode
 * posts every few seconds and bcrypt would cost each post ~50 ms of CPU. The
 * pepper is what bcrypt's slowness bought a PAT: a stolen database without the
 * instance key does not even let a candidate token be checked.
 *
 * A token is bound to its app (`kind`): an OwnTracks token on the Overland
 * path does not verify. A revoked token is dead; an account that is
 * deactivated stops every token it holds.
 */

export const INGEST_TOKEN_PREFIX = "tt_ingest_";
const TOKEN_BYTES = 32;
const TOKEN_SHAPE = /^tt_ingest_[0-9a-f]{64}$/;

export const INGEST_TOKEN_KINDS = ["owntracks", "overland"] as const;
export type IngestTokenKind = (typeof INGEST_TOKEN_KINDS)[number];

/** Live tokens one account may hold: a few phones, and headroom. */
export const MAX_INGEST_TOKENS = 10;

/** `lastUsedAt` is written at most this often per token, not on every post. */
const LAST_USED_RESOLUTION_MS = 60_000;

const LOOKUP_LABEL = "travtrack-ingest-token-lookup";
const VERIFY_LABEL = "travtrack-ingest-token-verify";

type Digests = { lookupHash: string; hash: string };

const digest = (key: Buffer, token: string) =>
  createHmac("sha256", key).update(token).digest("hex");

/** The two digests of `token` under a given instance key (64 hex characters). */
export function ingestTokenDigestsWith(instanceKeyHex: string, token: string): Digests {
  return {
    lookupHash: digest(deriveSecretFrom(instanceKeyHex, LOOKUP_LABEL), token),
    hash: digest(deriveSecretFrom(instanceKeyHex, VERIFY_LABEL), token),
  };
}

let keys: { lookup: Buffer; verify: Buffer } | null = null;
function instanceKeys() {
  keys ??= {
    lookup: deriveInstanceSecret(LOOKUP_LABEL),
    verify: deriveInstanceSecret(VERIFY_LABEL),
  };
  return keys;
}

function digests(token: string): Digests {
  const k = instanceKeys();
  return { lookupHash: digest(k.lookup, token), hash: digest(k.verify, token) };
}

/** Cheap structural check before any database work. */
export const looksLikeIngestToken = (v: unknown): v is string =>
  typeof v === "string" && TOKEN_SHAPE.test(v);

export const isIngestTokenKind = (v: unknown): v is IngestTokenKind =>
  (INGEST_TOKEN_KINDS as readonly unknown[]).includes(v);

export type IngestTokenListing = {
  id: string;
  kind: IngestTokenKind;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

/** A new token. The plaintext is in the answer and nowhere else, ever. */
export async function createIngestToken(
  userId: string,
  input: { kind: IngestTokenKind; label: string }
): Promise<IngestTokenListing & { token: string }> {
  const token = `${INGEST_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("hex")}`;
  const { lookupHash, hash } = digests(token);
  const row = await prisma.$transaction(async (tx) => {
    // Serialises an account's creates, so two at once cannot both pass the count.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ingest-token:${userId}`}, 0))`;
    const live = await tx.travTrackIngestToken.count({ where: { userId, revokedAt: null } });
    if (live >= MAX_INGEST_TOKENS) {
      throw new AppError(
        "This account holds the most ingest tokens there may be",
        409,
        "INGEST_TOKEN_LIMIT"
      );
    }
    return tx.travTrackIngestToken.create({
      data: { userId, kind: input.kind, label: input.label, lookupHash, hash },
      select: { id: true, kind: true, label: true, createdAt: true, lastUsedAt: true },
    });
  });
  return { ...row, kind: row.kind as IngestTokenKind, token };
}

/** The account's live tokens, newest first — never a secret or a digest. */
export async function listIngestTokens(userId: string): Promise<IngestTokenListing[]> {
  const rows = await prisma.travTrackIngestToken.findMany({
    where: { userId, revokedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { id: true, kind: true, label: true, createdAt: true, lastUsedAt: true },
  });
  return rows.map((r) => ({ ...r, kind: r.kind as IngestTokenKind }));
}

/** Revokes a live token of this account; anything else is 404. */
export async function revokeIngestToken(userId: string, id: string): Promise<void> {
  const { count } = await prisma.travTrackIngestToken.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) {
    throw new AppError("No such ingest token", 404, "INGEST_TOKEN_NOT_FOUND");
  }
}

export type VerifiedIngestToken = { tokenId: string; userId: string; kind: IngestTokenKind };

/**
 * The token's owner, when `token` is a live token of `kind` of an active
 * account; otherwise null. The second digest is compared in constant time.
 */
export async function verifyIngestToken(
  token: string,
  kind: IngestTokenKind
): Promise<VerifiedIngestToken | null> {
  if (!looksLikeIngestToken(token)) return null;
  const { lookupHash, hash } = digests(token);
  const row = await prisma.travTrackIngestToken.findUnique({
    where: { lookupHash },
    select: {
      id: true,
      userId: true,
      kind: true,
      hash: true,
      revokedAt: true,
      lastUsedAt: true,
      user: { select: { isActive: true } },
    },
  });
  if (!row) return null;
  const stored = Buffer.from(row.hash, "hex");
  const given = Buffer.from(hash, "hex");
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) return null;
  if (row.revokedAt !== null || row.kind !== kind || !row.user.isActive) return null;
  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS) {
    await prisma.travTrackIngestToken.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date(now) },
    });
  }
  return { tokenId: row.id, userId: row.userId, kind };
}
