#!/usr/bin/env node
/**
 * CLI wrapper around maybeRunPreMigrationBackup() for the production
 * docker-entrypoint.sh, which calls `prisma migrate deploy` directly
 * and never goes through src/init.ts. Without this script the
 * upgrade-backup hook only runs in `npm run dev`.
 *
 * Exit codes:
 *   0 — backup ran successfully OR was skipped (no major bump)
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
    console.log(
      `[pre-migration-backup] Major bump ${ctx.previousVersion} → ${ctx.currentVersion}`,
    );
  } else if (ctx.previousVersion === null) {
    console.log("[pre-migration-backup] Fresh install — no backup needed");
  } else {
    console.log(
      `[pre-migration-backup] Same major (${ctx.previousVersion} → ${ctx.currentVersion}) — no backup needed`,
    );
  }

  if (ctx.backupCreated) {
    console.log(`[pre-migration-backup] Backup written: ${ctx.backupCreated}`);
  } else if (ctx.shouldBackup) {
    console.log(
      "[pre-migration-backup] WARNING: major bump but backup failed — continuing",
    );
  }
}

main().catch((error) => {
  console.error("[pre-migration-backup] Unexpected error:", error);
  process.exit(1);
});
