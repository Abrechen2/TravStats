import type { DbTransaction } from "../../../db";

/**
 * One lock per account for every stay acceptance, whichever provider found the
 * stay (TravTrack plan E4, Codex review). Accepting reads the account's places
 * and visits to reuse one, then creates what is missing; two accepts of the
 * same stop must never both read "nothing there".
 *
 * Isolation alone did not hold that across providers: the Dawarich accept ran
 * Serializable, the TravTrack one READ COMMITTED (it must see what committed
 * while it waited for the TravTrack lock), and Postgres only serializes
 * Serializable transactions against each other. Both now take this lock as the
 * first statement and run READ COMMITTED: the second accept waits for the
 * first to commit, and every statement after the wait reads what it wrote.
 * Lock order is fixed — TravTrack lock, then this one; the Dawarich accept
 * takes only this one — so the two cannot deadlock.
 */
export async function takeStayAcceptLock(tx: DbTransaction, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stay-accept:${userId}`}, 0))`;
}
