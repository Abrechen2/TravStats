#!/usr/bin/env node
/**
 * CLI wrapper around maybeRunPreMigrationBackup() for the production
 * docker-entrypoint.sh, which calls `prisma migrate deploy` directly
 * and never goes through src/init.ts. Without this script the
 * upgrade-backup hook only runs in `npm run dev`.
 *
 * Exit codes:
 *   0 — backup ran successfully OR was skipped (not a version change)
 *   0 — backup attempted but failed (soft fail, see upgradeBackup.ts)
 *   1 — internal error before the backup attempt could complete
 *
 * Always exits 0 for the soft-fail case so the entrypoint can still
 * proceed to migrate. The migration remains the bottleneck.
 */
import { maybeRunPreMigrationBackup } from "../utils/upgradeBackup";

async function main(): Promise<void> {
  const ctx = await maybeRunPreMigrationBackup();

  if (ctx.firstUpgradeFromPreMarker) {
    console.log(
      `[pre-migration-backup] First upgrade with last-version marker → ${ctx.currentVersion}`,
    );
  } else if (ctx.shouldBackup) {
    // These lines still said "Major bump" and "Same major" long after #246
    // changed the rule to ANY version change. Watched live on the 2.5.2 →
    // 2.6.0 boot, the entrypoint announced a "Major bump" for a minor one —
    // the behaviour was right and the sentence was wrong, which is the kind of
    // thing an operator reads at 3am while deciding whether to roll back.
    console.log(
      `[pre-migration-backup] Version change ${ctx.previousVersion} → ${ctx.currentVersion}`,
    );
  } else if (ctx.previousVersion === null) {
    console.log("[pre-migration-backup] Fresh install — no backup needed");
  } else {
    console.log(
      `[pre-migration-backup] Same version (${ctx.currentVersion}) — no backup needed`,
    );
  }

  if (ctx.backupCreated) {
    console.log(`[pre-migration-backup] Backup written: ${ctx.backupCreated}`);
  } else if (ctx.shouldBackup) {
    console.log(
      "[pre-migration-backup] WARNING: version changed but backup failed — continuing",
    );
  }
}

main().catch((error) => {
  console.error("[pre-migration-backup] Unexpected error:", error);
  process.exit(1);
});
