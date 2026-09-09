import type { Prisma } from "@prisma/client";

/**
 * One lock for every decision that rests on "how many users exist".
 *
 * Three places ask that question and then write: self-registration, the
 * first-boot setup route, and an administrator creating an account. Two of the
 * answers are consequential — who becomes the bootstrap administrator, and
 * whether the instance is already full — and none of the three took any lock.
 *
 * Serializable is not enough here, and that is measured rather than assumed. On
 * 2026-09-09 four registrations racing against an empty instance ALL read zero
 * inside their own serializable transactions and two of them committed as
 * admin; an isolated probe whose transactions were held open longer DID abort
 * three of four with P2034. So the isolation level does protect this — when the
 * transactions overlap the right way. "Usually" is not a property to hand the
 * only administrator of an instance (audit finding AUD-004).
 *
 * The lock is transaction-scoped: COMMIT or ROLLBACK releases it, so no caller
 * needs a `finally`, and a crashed connection cannot leave it held. The key is
 * an arbitrary constant, shared by all three callers on purpose — a second key
 * would mean two of them could not see each other, which is the bug again with
 * more steps.
 */
const USER_COUNT_LOCK_KEY = 8314207733n;

/** Minimal shape: a Prisma client or an interactive transaction client. */
type RawCapable = {
  $executeRaw: Prisma.TransactionClient["$executeRaw"];
};

/**
 * Take the lock for the rest of the CURRENT transaction.
 *
 * Must be called inside `prisma.$transaction`. Called on the top-level client it
 * would take the lock in its own implicit transaction and release it again at
 * once, which looks like protection and is none.
 */
export async function takeUserCountLock(tx: RawCapable): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${USER_COUNT_LOCK_KEY})`;
}
