#!/usr/bin/env node
/**
 * Switch two-factor off for one account, from a shell.
 *
 *   docker exec -it TravStats node dist/scripts/disableTwoFactor.js <username>
 *
 * This is deliberately not guarded by a password. Anyone who can run a command
 * inside this container already holds the database: they can read every flight,
 * dump it, or rotate the JWT secret. A command that clears a 2FA flag grants
 * nothing that the shell did not already grant — so it is a way out for the
 * owner, not a way in for an attacker.
 */
import { prisma } from "../db";
import logger from "../utils/logger";

export async function disableTwoFactorForUsername(username: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });
  if (!user) return false;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorSecret: null,
        twoFactorPendingSecret: null,
        twoFactorEnabledAt: null,
        twoFactorToken: null,
        twoFactorTokenExpiry: null,
      },
    }),
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } }),
  ]);

  logger.warn({ operation: "two_factor_disabled_via_cli", username });
  return true;
}

async function main(): Promise<void> {
  const username = process.argv[2];
  if (!username) {
    process.stderr.write("Usage: node dist/scripts/disableTwoFactor.js <username>\n");
    process.exit(2);
  }

  const done = await disableTwoFactorForUsername(username);
  if (done) {
    process.stdout.write(`Two-factor authentication disabled for "${username}".\n`);
    process.stdout.write("The next login needs the password only.\n");
  } else {
    process.stderr.write(`No user named "${username}".\n`);
  }
  await prisma.$disconnect();
  process.exit(done ? 0 : 1);
}

// Guarded so importing this module from a test does not run the CLI.
if (require.main === module) {
  void main();
}
