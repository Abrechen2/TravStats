import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { resolveRpConfig } from "./rpConfig";
import { putChallenge, takeChallenge } from "./challengeStore";

/**
 * Re-authentication with a passkey, for the account that is already signed in.
 *
 * Same ceremony as the passkey login (`userVerification: "required"` on the
 * options AND `requireUserVerification: true` on the check — relaxing either
 * turns this into a bare-possession check), but bound to the caller: the options
 * list only the caller's own credentials and the challenge is keyed to the user
 * id, so an assertion made for another account or for the login ceremony cannot
 * be replayed here. Failures answer 403 with a stable code: the client treats a
 * 401 as "your session is gone" and signs out.
 */
const reauthKey = (userId: string): string => `reauth:${userId}`;

export async function issueReauthOptions(userId: string) {
  const rp = await resolveRpConfig();
  if (!rp) {
    throw new AppError("Passkeys are not available on this instance", 409, "PASSKEY_UNAVAILABLE");
  }
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });
  if (credentials.length === 0) {
    throw new AppError("This account has no passkey", 409, "NO_PASSKEY");
  }
  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    userVerification: "required",
    allowCredentials: credentials.map((c) => ({
      id: c.credentialId,
      transports: c.transports as never,
    })),
  });
  putChallenge(reauthKey(userId), options.challenge);
  return options;
}

/** Resolves when the assertion proves a passkey of `userId`; throws 403 otherwise. */
export async function verifyReauthAssertion(
  userId: string,
  response: Record<string, unknown>
): Promise<void> {
  const refuse = (): never => {
    throw new AppError("The passkey could not be verified", 403, "DELETE_PASSKEY_INVALID");
  };
  const rp = await resolveRpConfig();
  if (!rp) {
    throw new AppError("Passkeys are not available on this instance", 409, "PASSKEY_UNAVAILABLE");
  }
  const expectedChallenge = takeChallenge(reauthKey(userId));
  if (!expectedChallenge) return refuse();

  const credentialId = typeof response.id === "string" ? response.id : null;
  if (!credentialId) return refuse();
  const stored = await prisma.webAuthnCredential.findUnique({ where: { credentialId } });
  if (!stored || stored.userId !== userId) return refuse();

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        publicKey: Buffer.from(stored.publicKey, "base64url"),
        counter: Number(stored.counter),
        transports: stored.transports as never,
      },
    });
  } catch (error) {
    logger.warn({ operation: "passkey_reauth_failed", userId, error: String(error) });
    return refuse();
  }
  if (!verification.verified) return refuse();

  const newCounter = verification.authenticationInfo.newCounter;
  if (stored.counter > 0n && BigInt(newCounter) <= stored.counter) {
    logger.warn({ operation: "passkey_counter_regression", userId, credentialId });
    return refuse();
  }
  await prisma.webAuthnCredential.update({
    where: { id: stored.id },
    data: { counter: BigInt(newCounter), lastUsedAt: new Date() },
  });
}
