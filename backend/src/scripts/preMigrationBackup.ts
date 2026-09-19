#!/usr/bin/env node
/**
 * CLI wrapper around maybeRunPreMigrationBackup() for the production
 * docker-entrypoint.sh, which calls `prisma migrate deploy` directly
 * and never goes through src/init.ts. Without this script the
 * upgrade-backup hook only runs in `npm run dev`.
 *
 * Exit codes:
 *   0 — backup ran successfully, or was not needed (no version change)
 *   0 — backup failed but SKIP_PRE_MIGRATION_BACKUP=true was set
 *   1 — backup failed on a version change, or an internal error
 *
 * A non-zero exit MUST stop the boot: the entrypoint runs `prisma migrate
 * deploy` immediately after this, and the whole point of the hook is that the
 * snapshot exists before it does. It exited 0 on failure until 2026-09-19 —
 * see `preMigrationOutcome` in utils/upgradeBackup.ts for what that cost.
 */
import {
  maybeRunPreMigrationBackup,
  preMigrationOutcome,
  skipPreMigrationBackupRequested,
} from "../utils/upgradeBackup";

async function main(): Promise<void> {
  const ctx = await maybeRunPreMigrationBackup();

  if (ctx.firstUpgradeFromPreMarker) {
    console.log(
      `[pre-migration-backup] First upgrade with last-version marker → ${ctx.currentVersion}`
    );
  } else if (ctx.shouldBackup) {
    // These lines still said "Major bump" and "Same major" long after #246
    // changed the rule to ANY version change. Watched live on the 2.5.2 →
    // 2.6.0 boot, the entrypoint announced a "Major bump" for a minor one —
    // the behaviour was right and the sentence was wrong, which is the kind of
    // thing an operator reads at 3am while deciding whether to roll back.
    console.log(
      `[pre-migration-backup] Version change ${ctx.previousVersion} → ${ctx.currentVersion}`
    );
  } else if (ctx.previousVersion === null) {
    console.log("[pre-migration-backup] Fresh install — no backup needed");
  } else {
    console.log(`[pre-migration-backup] Same version (${ctx.currentVersion}) — no backup needed`);
  }

  const outcome = preMigrationOutcome({
    shouldBackup: ctx.shouldBackup,
    backupCreated: ctx.backupCreated,
    backupError: ctx.backupError,
    skipRequested: skipPreMigrationBackupRequested(),
  });

  for (const line of outcome.lines) {
    if (outcome.fatal) console.error(line);
    else console.log(line);
  }

  if (outcome.fatal) process.exit(1);
}

main().catch((error) => {
  console.error("[pre-migration-backup] Unexpected error:", error);
  process.exit(1);
});
