import { prisma } from "../db";

/**
 * Password-reset requests on an instance that cannot send mail (forgejo#88,
 * point 2).
 *
 * The trade is stated in `model PasswordResetRequest`: one row per user, so an
 * unauthenticated route can write here without the table being able to grow
 * past the user table. Everything below keeps that property — there is no code
 * path that creates a second row for the same account, and none that writes a
 * row for a name that matches no account.
 */

/** One open request, as the inbox reads it. */
export interface OpenPasswordResetRequest {
  id: string;
  userId: string;
  username: string;
  requestedAt: Date;
}

/**
 * Record — or refresh — the request for one existing account.
 *
 * Asking twice is still one open question, so a repeat updates `requestedAt`
 * and re-opens a request an admin had already stamped. The admin is meant to
 * see the LATEST ask, not the first one: a request from three weeks ago that
 * was handled, followed by one from this morning, is one person who is locked
 * out again.
 *
 * The caller must have established that the user exists. This function does not
 * look it up, so it cannot be used to probe for one.
 */
export async function recordPasswordResetRequest(userId: string): Promise<void> {
  const now = new Date();
  await prisma.passwordResetRequest.upsert({
    where: { userId },
    create: { userId, requestedAt: now },
    update: { requestedAt: now, handledAt: null },
  });
}

/**
 * Every request still waiting for an administrator, newest first.
 *
 * Admin-only by where it is mounted (`routes/admin/*` is behind `requireAdmin`
 * for every route) — there is no per-user view of this table, on purpose. A
 * normal user learning that someone asked to reset THEIR password is a
 * notification; a normal user learning it about somebody else is a list of who
 * is locked out of this instance.
 */
export async function listOpenPasswordResetRequests(): Promise<OpenPasswordResetRequest[]> {
  const rows = await prisma.passwordResetRequest.findMany({
    where: { handledAt: null },
    orderBy: { requestedAt: "desc" },
    select: {
      id: true,
      userId: true,
      requestedAt: true,
      user: { select: { username: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    username: row.user.username,
    requestedAt: row.requestedAt,
  }));
}

/**
 * "I have dealt with this."
 *
 * Returns null when the id names nothing still open — a second click, or a
 * request the user re-opened in the meantime, is not an error the admin needs
 * to read about, but it is also not a success, so the caller decides.
 *
 * `updateMany` with `handledAt: null` in the WHERE is what makes the stamp
 * idempotent under two admins clicking at once: the loser updates no row and
 * gets null, rather than overwriting the winner's timestamp with its own.
 */
export async function markPasswordResetRequestHandled(id: string): Promise<Date | null> {
  const handledAt = new Date();
  const { count } = await prisma.passwordResetRequest.updateMany({
    where: { id, handledAt: null },
    data: { handledAt },
  });
  return count > 0 ? handledAt : null;
}
