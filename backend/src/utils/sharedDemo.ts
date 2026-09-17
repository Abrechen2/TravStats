/**
 * Which account is THE shared demo account.
 *
 * `isDemo` alone does not answer that. `seedDemoUser` sets the flag on every
 * account it creates — on the public preview that is `admin`, `alex` and
 * `claude`, locally it is the dev `admin:admin123` — and those are ordinary
 * accounts whose owner is the only one holding the password. Locking the
 * credential, token and connection routes on the flag alone locked all four
 * out of their own settings (final review finding C1).
 *
 * The shared account is the one whose password is PUBLISHED on the login page
 * of a public instance: `demo`, seeded by `seedDemoAccount.ts`. The flag stays
 * in the predicate because it is what marks the row as sample data (its
 * flights are kept out of instance-wide statistics, and it may not spend the
 * RapidAPI quota) — `demo` without the flag is a user who happened to pick the
 * name on their own instance, and nothing published gets them in.
 *
 * This file, not `seedDemoAccount.ts`, owns the username: importing the seed
 * from middleware would drag the whole seeding machinery into the running app.
 */
import { prisma } from "../db";

export const DEMO_USERNAME = "demo";

export function isSharedDemoAccount(user: { isDemo: boolean; username: string }): boolean {
  return user.isDemo && user.username === DEMO_USERNAME;
}

/**
 * The same question, asked of an id.
 *
 * It lives here rather than in `middleware/demoGuard.ts`, where it started,
 * because SERVICES ask it too since the independent review of 2026-09-17
 * (finding A2: the Immich and Dawarich resolvers must hand the shared account
 * no instance connection). A service reaching into a middleware for a
 * predicate would invert the layering; `demoGuard` re-exports this one so its
 * existing callers are unaffected.
 */
export async function isSharedDemoUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isDemo: true, username: true },
  });
  return user ? isSharedDemoAccount(user) : false;
}
