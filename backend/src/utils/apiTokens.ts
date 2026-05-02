/**
 * Personal Access Token (PAT) helpers.
 *
 * Tokens are formatted as `ts_pat_<32-byte-hex>` (74 chars total). The
 * plaintext is shown to the user exactly once on creation; the DB
 * stores two derived values:
 *
 *   - lookupHash: SHA-256(plaintext), uniquely indexed. Lets a single
 *     query find the candidate token row in O(1) instead of bcrypt-
 *     comparing against every active token (which would scale linearly
 *     and is unbearable above a few dozen tokens).
 *
 *   - hash: bcrypt(plaintext). The actual constant-time secret check
 *     once the row is known. SHA-256 alone is not used as the secret
 *     comparison because it is fast and would let an attacker who
 *     stole the DB enumerate tokens via offline dictionary attack.
 *
 * Token shape rationale: a stable `ts_pat_` prefix (TravStats Personal
 * Access Token) makes leaked tokens trivially identifiable in logs,
 * GitHub secret scanners, and Splunk-style detection rules.
 */

import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcrypt";

const TOKEN_PREFIX = "ts_pat_";
const TOKEN_BYTES = 32;
const BCRYPT_ROUNDS = 10;

export const API_TOKEN_PREFIX = TOKEN_PREFIX;

export type ApiTokenScope = "read" | "write" | "admin";

export const API_TOKEN_SCOPES: readonly ApiTokenScope[] = ["read", "write", "admin"] as const;

export const isApiTokenScope = (s: unknown): s is ApiTokenScope =>
  typeof s === "string" && (API_TOKEN_SCOPES as readonly string[]).includes(s);

export interface GeneratedToken {
  plaintext: string; // returned once to the user; never persisted
  lookupHash: string; // SHA-256, uniquely indexed
  hash: string; // bcrypt, constant-time compared on each request
}

/**
 * Generate a new PAT. The returned `plaintext` is the only value the
 * user will ever see — display it immediately and discard from memory.
 */
export async function generateApiToken(): Promise<GeneratedToken> {
  const random = randomBytes(TOKEN_BYTES).toString("hex");
  const plaintext = `${TOKEN_PREFIX}${random}`;
  const lookupHash = sha256Hex(plaintext);
  const hash = await bcrypt.hash(plaintext, BCRYPT_ROUNDS);
  return { plaintext, lookupHash, hash };
}

/**
 * SHA-256 the candidate plaintext for the indexed lookup. Cheap and
 * deterministic — used only to find the row, NOT as the auth check.
 */
export function tokenLookupHash(plaintext: string): string {
  return sha256Hex(plaintext);
}

/**
 * Constant-time compare the candidate plaintext against the stored
 * bcrypt hash. Always run this even after the lookup succeeds — the
 * lookup hash by itself is not sufficient because SHA-256 is fast
 * enough to brute-force offline if the DB ever leaks.
 */
export async function verifyApiToken(plaintext: string, bcryptHash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, bcryptHash);
}

/**
 * Cheap structural validation before hitting the DB. Rejects garbage
 * (random Authorization headers from misconfigured proxies) so we
 * never bcrypt-compare against attacker-controlled junk.
 */
export function looksLikeApiToken(s: string): boolean {
  if (!s.startsWith(TOKEN_PREFIX)) return false;
  const body = s.slice(TOKEN_PREFIX.length);
  return body.length === TOKEN_BYTES * 2 && /^[0-9a-f]+$/i.test(body);
}

const sha256Hex = (input: string): string =>
  createHash("sha256").update(input).digest("hex");
