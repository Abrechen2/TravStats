import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * forgejo#157 — the Docker entrypoint's migration step, run as shell.
 *
 * Measured on 2026-10-02: a migration that failed (P3018) printed a warning
 * and the app started anyway; on the next boot Prisma refused every later
 * migration (P3009), the name-extracting sed found nothing in Prisma 7's
 * output, and the app started healthy again — every migration of every later
 * update skipped. The two blocks below are cut out of docker-entrypoint.sh by
 * their markers and run under /bin/sh (dash, as in the image) with a stand-in
 * `npx`, so this tests the script that ships, not a copy of it.
 */

const ENTRYPOINT = path.join(__dirname, "../../../docker-entrypoint.sh");

function block(name: string): string {
  const script = fs.readFileSync(ENTRYPOINT, "utf-8");
  const start = script.indexOf(`# >>> ${name}`);
  const end = script.indexOf(`# <<< ${name}`);
  if (start < 0 || end < start) throw new Error(`marker block ${name} not found`);
  return script.slice(start, end);
}

/** Runs the gate under sh with a fake `npx` that waits `sleep` seconds, prints `output`, exits `exitCode`. */
function runGate(fake: { output: string; exitCode: number; sleep?: number }, timeout = "5") {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "entrypoint-gate-"));
  fs.writeFileSync(
    path.join(bin, "npx"),
    `#!/bin/sh\nsleep ${fake.sleep ?? 0}\ncat <<'OUT'\n${fake.output}\nOUT\nexit ${fake.exitCode}\n`,
    { mode: 0o755 }
  );
  const script = `set -e\n${block("migration-gate")}\necho "[gate] app starts"\n`;
  const run = spawnSync("/bin/sh", ["-c", script], {
    encoding: "utf-8",
    env: { PATH: `${bin}:${process.env.PATH}`, MIGRATION_TIMEOUT_SECONDS: timeout },
  });
  fs.rmSync(bin, { recursive: true, force: true });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

describe("the entrypoint's migration gate", () => {
  it("starts the app when migrate deploy succeeds", () => {
    const run = runGate({ output: "All migrations have been successfully applied.", exitCode: 0 });
    expect(run.status).toBe(0);
    expect(run.output).toContain("[gate] app starts");
  });

  it("refuses to start on P3018, a migration that failed to apply", () => {
    const run = runGate({
      output: [
        "Applying migration `20261001193030_sync_change_feed`",
        "Error: P3018",
        "Migration name: 20261001193030_sync_change_feed",
        'ERROR: relation "sync_changes" already exists',
      ].join("\n"),
      exitCode: 1,
    });
    expect(run.status).toBe(1);
    expect(run.output).toContain("Refusing to start");
    expect(run.output).not.toContain("[gate] app starts");
  });

  it("refuses to start on P3009, a failed migration left recorded", () => {
    const run = runGate({
      output: [
        "Error: P3009",
        "migrate found failed migrations in the target database, new migrations will not be applied.",
        "The `20261001193030_sync_change_feed` migration started at 2026-10-02 17:00:00 UTC failed",
      ].join("\n"),
      exitCode: 1,
    });
    expect(run.status).toBe(1);
    expect(run.output).not.toContain("[gate] app starts");
  });

  it("refuses to start when migrations outlast MIGRATION_TIMEOUT_SECONDS, and names the variable", () => {
    const run = runGate({ output: "", exitCode: 0, sleep: 5 }, "1");
    expect(run.status).toBe(124);
    expect(run.output).toContain("MIGRATION_TIMEOUT_SECONDS");
    expect(run.output).not.toContain("[gate] app starts");
  });
});

describe("the entrypoint's failed-migration names", () => {
  function names(statusOutput: string): string[] {
    const script = `${block("failed-migration-names")}\nfailed_migration_names`;
    const run = spawnSync("/bin/sh", ["-c", script], { input: statusOutput, encoding: "utf-8" });
    return run.stdout.split("\n").filter(Boolean);
  }

  it("reads Prisma 7's block, and not the pending block or the resolve hints", () => {
    // `prisma migrate status` on 2026-10-04 with one migration left unfinished.
    const status = [
      "186 migrations found in prisma/migrations",
      "Following migration have failed:",
      "20261002172714_sync_feed_rentals_expenses_companions",
      "",
      "The failed migration(s) can be marked as rolled back or applied:",
      "- If you rolled back the migration(s) manually:",
      'prisma migrate resolve --rolled-back "20261002172714_sync_feed_rentals_expenses_companions"',
      "Following migration have not yet been applied:",
      "20261003000000_pending_one",
    ].join("\n");
    expect(names(status)).toEqual(["20261002172714_sync_feed_rentals_expenses_companions"]);
  });

  it("still reads the older one-line form", () => {
    expect(
      names(
        "The `20250120000000_add_training_config` migration started at 2025-01-20 10:00:00 UTC failed\n"
      )
    ).toEqual(["20250120000000_add_training_config"]);
  });
});
