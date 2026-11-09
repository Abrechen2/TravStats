/** Test helper for the admission suites: users, keys and request rows. Not a suite. */
import { generateKeyPairSync, randomUUID } from "crypto";
import { prisma } from "../../../db";
import { encryptApiKey } from "../../../utils/encryption";
import { hash } from "../refusal";
import { ADMISSION_WINDOW_MS } from "../admission";

export function peerKey() {
  const pair = generateKeyPairSync("ed25519");
  const pem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  return { ...pair, pem, fingerprint: hash(pem) };
}

export const makeUser = (prefix: string, isAdmin = false) =>
  prisma.user.create({
    data: { username: `${prefix}-${randomUUID().slice(0, 8)}`, passwordHash: "test-only", isAdmin },
  });

export async function makeRequest(
  userId: string,
  origin: string,
  key: ReturnType<typeof peerKey>,
  overrides: Partial<{
    direction: string;
    status: string;
    scope: object;
    inviteHash: string;
    token: string;
  }> = {}
) {
  return prisma.federationAdmissionRequest.create({
    data: {
      direction: overrides.direction ?? "incoming",
      origin,
      publicKey: key.pem,
      fingerprint: key.fingerprint,
      localUserId: userId,
      inviteRef: encryptApiKey(overrides.token ?? "a".repeat(64)) as string,
      inviteHash: overrides.inviteHash,
      scope: overrides.scope as never,
      status: overrides.status ?? "pending",
      expiresAt: new Date(Date.now() + ADMISSION_WINDOW_MS),
    },
  });
}
