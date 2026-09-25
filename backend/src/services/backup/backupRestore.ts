import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { DATABASE_URL } from "../../utils/database";
import {
  BACKUP_BASE_DIR,
  DOCKER_DB_CONTAINER,
  ENCRYPTION_FINGERPRINT_KEY,
  RestoreOptions,
} from "./backupConfig";
import { parseDatabaseUrl } from "./backupDatabase";
import { AppError } from "../../middleware/errorHandler";
import { encryptionKeyFingerprint } from "../../utils/encryption";
import { reconcileInterruptedBackups } from "./reconcileBackups";

/**
 * The columns of `admin_settings` that describe THIS MACHINE rather than the
 * data in it.
 *
 * A dump carries them like everything else, so a restore silently adopts the
 * identity of whichever instance produced it. That is not hypothetical: on
 * 2026-09-05 prod was rebuilt from an RC dump and inherited the RC's three
 * URLs, so every pairing QR prod printed for the next three days sent the
 * phone to a different server, where the code was unknown. It took until
 * 2026-09-08 to find, because nothing about the running instance looked wrong
 * (forgejo#115).
 *
 * The two WebAuthn columns are here for the same reason and are the more
 * dangerous half: a relying-party id is bound to a host, and a credential is
 * bound to ONE rpId forever. Adopting a foreign one does not degrade passkey
 * sign-in, it ends it.
 *
 * `null` is a real value here — it means "no override, fall back to ENV" — so
 * the raw row is read rather than the resolved settings, and a restore puts an
 * instance back on its own ENV rather than persisting it into the database.
 */
const INSTANCE_IDENTITY_COLUMNS = [
  "frontendUrl",
  "publicUrl",
  "lanUrl",
  "webauthnRpId",
  "webauthnOrigins",
] as const;

type InstanceIdentity = {
  frontendUrl: string | null;
  publicUrl: string | null;
  lanUrl: string | null;
  webauthnRpId: string | null;
  webauthnOrigins: string[];
};

export async function readInstanceIdentity(): Promise<InstanceIdentity | null> {
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: {
      frontendUrl: true,
      publicUrl: true,
      lanUrl: true,
      webauthnRpId: true,
      webauthnOrigins: true,
    },
  });
  return row ?? null;
}

/**
 * Put this instance's own identity back over whatever the dump brought.
 *
 * Deliberately loud: an administrator who restored a dump in order to ADOPT
 * its identity needs to see that it was overwritten, and the log names both
 * sides so the difference is readable without a database client.
 *
 * Exported for its test, like `extractUploadsArchive` above: the behaviour is
 * a before/after pairing around a psql run, and a test that drives the whole
 * restore to reach it would prove nothing more.
 */
export async function restoreInstanceIdentity(before: InstanceIdentity | null): Promise<void> {
  if (!before) return;

  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: {
      id: true,
      frontendUrl: true,
      publicUrl: true,
      lanUrl: true,
      webauthnRpId: true,
      webauthnOrigins: true,
    },
  });
  if (!row) return;

  const changed = INSTANCE_IDENTITY_COLUMNS.filter((column) => {
    const mine = before[column];
    const theirs = row[column];
    return Array.isArray(mine) || Array.isArray(theirs)
      ? JSON.stringify(mine ?? []) !== JSON.stringify(theirs ?? [])
      : mine !== theirs;
  });

  if (changed.length === 0) return;

  await prisma.adminSettings.update({
    where: { id: row.id },
    data: {
      frontendUrl: before.frontendUrl,
      publicUrl: before.publicUrl,
      lanUrl: before.lanUrl,
      webauthnRpId: before.webauthnRpId,
      webauthnOrigins: before.webauthnOrigins,
    },
  });

  logger.warn({
    operation: "restore_instance_identity_kept",
    message:
      "The archive carried another instance's identity; this instance kept its own. Set these under Settings -> Instance if the archive's values were the intended ones.",
    fields: changed,
    kept: before,
    discarded: Object.fromEntries(changed.map((column) => [column, row[column]])),
  });
}

/**
 * Restore backup
 */
/**
 * psql's own exit code is not an opinion about the SQL it just ran.
 *
 * Without ON_ERROR_STOP it reports every statement's failure on stderr, carries
 * on with the next one and exits 0. Measured on 2026-09-09: restoring a backup
 * over a database that had moved on produced "relation already exists" and
 * duplicate-key errors for the whole file, exit code 0, a success message in the
 * UI — and the old data untouched (audit finding AUD-007). A restore that
 * silently does nothing is worse than one that fails, because it is believed.
 *
 * --single-transaction makes it all-or-nothing as well: a restore that stops
 * halfway leaves a database that is neither the backup nor what was there.
 *
 * The dumps carry --clean --if-exists since the same day, so a restore now
 * REPLACES what it finds. An archive written before that will fail here rather
 * than pretend, and the message says which — see the catch below.
 */
/**
 * Unpack an uploads archive so the files land where their database rows expect.
 *
 * The archive stores its entries as `uploads/<dir>/...` (see backupFiles.ts), so
 * the extraction target is the PARENT of the uploads directory, not the uploads
 * directory itself. Extracting into `uploads` produced `uploads/uploads/<dir>/…`:
 * every image and receipt restored, reported as restored, and unreachable under
 * the filename stored in the database (audit finding AUD-006).
 *
 * Fixing the target rather than the archive layout keeps every backup already
 * written restorable — the old archives are not wrong, the unpacking was.
 *
 * Exported for the round-trip test: the pairing of layout and target is the
 * thing that broke, and a test that only reads the tarball cannot see it.
 */
export async function extractUploadsArchive(
  archivePath: string,
  uploadsDir: string
): Promise<void> {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const uploadsParent = path.dirname(uploadsDir);

  await new Promise<void>((resolve, reject) => {
    const tar = spawn("tar", ["-xzf", archivePath, "-C", uploadsParent], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    // Carry tar's own complaint into the error. A restore that fails is the
    // moment somebody most needs to know WHY, and an exit code alone sends them
    // looking in the wrong place.
    let stderr = "";
    tar.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    tar.on("close", (code: number) => {
      if (code !== 0) {
        const detail = stderr.trim().split("\n").slice(0, 3).join("; ");
        reject(new Error(`tar extraction failed with code ${code}${detail ? `: ${detail}` : ""}`));
      } else {
        resolve();
      }
    });

    tar.on("error", reject);
  });
}

const PSQL_STRICT = ["-v", "ON_ERROR_STOP=1", "--single-transaction"] as const;

/** Everything a restore can find wrong with an archive before it writes. */
export type RestoreArchiveProblem =
  | { kind: "missingDatabasePart" }
  | { kind: "missingFilesPart" }
  | { kind: "unreadableFilesPart"; detail: string }
  | { kind: "encryptionKeyMismatch"; archiveFingerprint: string; ownFingerprint: string };

/** Can `tar` read this archive end to end? The answer, not an exception. */
async function listArchive(
  archivePath: string
): Promise<{ ok: true } | { ok: false; detail: string }> {
  return new Promise((resolve) => {
    // `-t` lists without extracting, so this reads the whole archive and
    // writes nothing. It costs one full read of the uploads tarball before the
    // restore reads it again — accepted, because the alternative is finding
    // out it is corrupt with the database already replaced.
    const tar = spawn("tar", ["-tzf", archivePath], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    tar.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    tar.on("close", (code: number) => {
      if (code === 0) resolve({ ok: true });
      else
        resolve({
          ok: false,
          detail: stderr.trim().split("\n").slice(0, 3).join("; ") || `tar exited with ${code}`,
        });
    });
    tar.on("error", (error) => resolve({ ok: false, detail: error.message }));
  });
}

/**
 * Everything wrong with an extracted archive, asked BEFORE the restore writes.
 *
 * Two audit findings of 2026-09-20 live here, and they are the same defect
 * seen from two sides.
 *
 * SRV-RESTORE-002: a full restore whose `uploads.tar.gz` was corrupt replaced
 * the database first and then died unpacking the files. The database had
 * already moved — psql's `--single-transaction` rolls back a failing SQL run,
 * but it cannot roll back a run that SUCCEEDED before a later step failed. The
 * restore answered with an error over a database that was neither the archive
 * nor what had been there, and only the optional safety backup could undo it.
 *
 * SRV-RESTORE-003: a FILES restore from an archive with no `uploads.tar.gz`
 * logged a warning, skipped the only thing it had been asked to do, and
 * answered 200. Success is a claim about what happened; nothing had.
 *
 * SRV-RESTORE-001 is the third: the archive carries encrypted API keys, SMTP
 * passwords and Immich/Dawarich tokens, and the key that wrote them lives in
 * `/app/data/secrets`, which is NOT in the archive. Restoring onto an instance
 * with different secrets therefore completes and reports success while every
 * one of those values becomes unreadable — measured as `hasKey=true`,
 * `hasAccess=false`, connection test 400. The fingerprint in `metadata.json`
 * makes that decidable; the caller decides what to do about it.
 *
 * Returns the problems rather than throwing, so the caller can rank them: an
 * encryption-key mismatch is acknowledgeable, a corrupt archive is not.
 * Archives written before the fingerprint existed carry none, and a missing
 * one is NOT reported — an absent answer is not a wrong one, and refusing
 * every older archive would be a worse bug than the one this prevents.
 */
export async function inspectRestoreArchive(
  tempDir: string,
  scope: RestoreOptions["scope"]
): Promise<RestoreArchiveProblem[]> {
  const problems: RestoreArchiveProblem[] = [];
  const dbBackupPath = path.join(tempDir, "database.sql");
  const filesBackupPath = path.join(tempDir, "uploads.tar.gz");
  const wantsDatabase = scope === "full" || scope === "database";
  const wantsFiles = scope === "full" || scope === "files";

  if (wantsDatabase && !fs.existsSync(dbBackupPath)) {
    problems.push({ kind: "missingDatabasePart" });
  }

  if (wantsFiles) {
    if (!fs.existsSync(filesBackupPath)) {
      problems.push({ kind: "missingFilesPart" });
    } else {
      const listed = await listArchive(filesBackupPath);
      if (!listed.ok) problems.push({ kind: "unreadableFilesPart", detail: listed.detail });
    }
  }

  if (wantsDatabase) {
    const archiveFingerprint = readArchiveEncryptionFingerprint(tempDir);
    const ownFingerprint = encryptionKeyFingerprint();
    if (archiveFingerprint && archiveFingerprint !== ownFingerprint) {
      problems.push({ kind: "encryptionKeyMismatch", archiveFingerprint, ownFingerprint });
    }
  }

  return problems;
}

/** The fingerprint `metadata.json` names, or null when it names none. A
 *  metadata file that will not parse is treated as naming none — it is a
 *  descriptive sidecar, and refusing a restore over it would be a new way to
 *  lose data. */
function readArchiveEncryptionFingerprint(tempDir: string): string | null {
  const metadataPath = path.join(tempDir, "metadata.json");
  if (!fs.existsSync(metadataPath)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
    if (!parsed || typeof parsed !== "object") return null;
    const value = (parsed as Record<string, unknown>)[ENCRYPTION_FINGERPRINT_KEY];
    return typeof value === "string" && value ? value : null;
  } catch (error) {
    logger.warn({
      operation: "restore_metadata_unreadable",
      message: "Could not read metadata.json from the archive; continuing without it",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

/** The refusal an unacceptable problem becomes. Each names what to do about
 *  it, because the admin reading it is mid-recovery. */
function toRestoreError(problem: RestoreArchiveProblem): AppError {
  switch (problem.kind) {
    case "missingDatabasePart":
      return new AppError(
        "This archive carries no database.sql, so the requested database restore cannot be performed.",
        400,
        "RESTORE_ARCHIVE_INCOMPLETE"
      );
    case "missingFilesPart":
      return new AppError(
        "This archive carries no uploads.tar.gz, so the requested file restore cannot be performed.",
        400,
        "RESTORE_ARCHIVE_INCOMPLETE"
      );
    case "unreadableFilesPart":
      return new AppError(
        `This archive's uploads.tar.gz cannot be read (${problem.detail}). Nothing was restored.`,
        400,
        "RESTORE_ARCHIVE_UNREADABLE"
      );
    case "encryptionKeyMismatch":
      return new AppError(
        "This archive was written by an instance with a different encryption key, so its stored API keys, " +
          "SMTP password and Immich/Dawarich tokens cannot be decrypted here. Put the original key back " +
          "(ENCRYPTION_KEY, or encryption.key in the secrets directory) and retry, or confirm the restore " +
          "to continue and enter those credentials again afterwards.",
        409,
        "RESTORE_ENCRYPTION_KEY_MISMATCH"
      );
  }
}

export async function restoreBackup(
  id: string,
  options: RestoreOptions,
  createBackupFn: (opts: { type: "full" }) => Promise<string>
): Promise<void> {
  const backup = await prisma.backup.findUnique({
    where: { id },
  });

  // Each precondition carries its status (forgejo#77): the route passes the
  // error straight to errorHandler, and a bare Error would reach the admin as
  // a 500 — a server fault — for an id that simply does not exist.
  if (!backup) {
    throw new AppError("Backup not found", 404);
  }

  if (backup.status !== "completed") {
    throw new AppError("Backup is not completed", 400);
  }

  if (!backup.backupPath || !fs.existsSync(backup.backupPath)) {
    throw new AppError("Backup file not found", 404);
  }

  const tempDir = path.join(BACKUP_BASE_DIR, "restore-temp");
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Extract archive
    logger.info({ operation: "restore_extract", message: "Extracting backup archive" });
    await new Promise<void>((resolve, reject) => {
      const tar = spawn("tar", ["-xzf", backup.backupPath!, "-C", tempDir]);

      tar.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`tar extraction failed with code ${code}`));
        } else {
          resolve();
        }
      });

      tar.on("error", reject);
    });

    // Every objection to this archive, BEFORE a byte is written and before the
    // safety backup is taken — a refused restore should cost neither a changed
    // database nor a pointless archive. See `inspectRestoreArchive` for the
    // three audit findings this ordering answers.
    const problems = await inspectRestoreArchive(tempDir, options.scope);
    const refusals = problems.filter(
      (problem) => !(problem.kind === "encryptionKeyMismatch" && options.acceptEncryptionKeyChange)
    );
    if (refusals.length > 0) {
      logger.warn({
        operation: "restore_refused",
        message: "Restore refused before writing anything",
        backupId: id,
        scope: options.scope,
        problems: refusals.map((problem) => problem.kind),
      });
      throw toRestoreError(refusals[0]);
    }
    if (problems.some((problem) => problem.kind === "encryptionKeyMismatch")) {
      logger.warn({
        operation: "restore_encryption_key_mismatch_accepted",
        message:
          "The archive's encrypted values were written with a different key and will not decrypt here; the caller accepted this. Every stored API key, SMTP password and Immich/Dawarich token has to be entered again.",
        backupId: id,
      });
    }

    // Create backup before restore if requested. After the preflight, so a
    // broken archive does not leave a spurious archive behind.
    if (options.createBackupBefore) {
      logger.info({
        operation: "restore_backup_before",
        message: "Creating backup before restore",
      });
      await createBackupFn({ type: "full" });
    }

    const dbBackupPath = path.join(tempDir, "database.sql");
    const filesBackupPath = path.join(tempDir, "uploads.tar.gz");

    // Restore database if requested
    if (options.scope === "full" || options.scope === "database") {
      logger.info({ operation: "restore_db", message: "Restoring database" });
      // Read BEFORE psql runs — afterwards the row belongs to the archive.
      const identityBefore = await readInstanceIdentity();
      // NOTE: no HTTP surface sets `targetDatabaseUrl`. The admin UI used to
      // offer a field for it and the route's Zod schema silently dropped it, so
      // an administrator who typed another database watched this instance be
      // overwritten instead (audit finding AUD-008). The field is gone; the
      // option stays for callers inside the process, and any future UI for it
      // has to add the schema entry AND show the resolved target before writing.
      const dbUrl = options.targetDatabaseUrl || DATABASE_URL;
      const dbInfo = parseDatabaseUrl(dbUrl);

      const isDocker = process.env.DOCKER === "true";
      const dbContainer = process.env.DOCKER_DB_CONTAINER || DOCKER_DB_CONTAINER;

      // Use spawn with array args to prevent shell injection (never interpolate into shell strings)
      const spawnRestore = (cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> =>
        new Promise<void>((resolve, reject) => {
          const inputFile = fs.createReadStream(dbBackupPath);
          const proc = spawn(cmd, args, {
            env,
            stdio: ["pipe", "pipe", "pipe"],
          });

          inputFile.pipe(proc.stdin);
          proc.stdout.on("data", (data) => {
            logger.debug({ operation: "restore_db_stdout", message: data.toString() });
          });
          proc.stderr.on("data", (data) => {
            logger.warn({ operation: "restore_db_stderr", message: data.toString() });
          });
          proc.on("error", (error) =>
            reject(new Error(`Failed to start ${cmd}: ${error.message}`))
          );
          proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited with code ${code}`));
          });
        });

      const restoreEnv = { ...process.env, PGPASSWORD: dbInfo.password };

      if (isDocker) {
        try {
          // Verify container exists using spawn (no shell interpolation)
          await new Promise<void>((resolve, reject) => {
            const proc = spawn(
              "docker",
              ["ps", "--filter", `name=${dbContainer}`, "--format", "{{.Names}}"],
              { stdio: ["ignore", "pipe", "pipe"] }
            );
            proc.on("close", (code) =>
              code === 0 ? resolve() : reject(new Error("Docker container not found"))
            );
            proc.on("error", reject);
          });
          await spawnRestore(
            "docker",
            ["exec", "-i", dbContainer, "psql", ...PSQL_STRICT, "-U", dbInfo.user, dbInfo.database],
            restoreEnv
          );
        } catch (_error) {
          // Fallback to direct psql if Docker not available
          await spawnRestore(
            "psql",
            [
              ...PSQL_STRICT,
              "-h",
              dbInfo.host,
              "-p",
              dbInfo.port.toString(),
              "-U",
              dbInfo.user,
              dbInfo.database,
            ],
            restoreEnv
          );
        }
      } else {
        await spawnRestore(
          "psql",
          [
            ...PSQL_STRICT,
            "-h",
            dbInfo.host,
            "-p",
            dbInfo.port.toString(),
            "-U",
            dbInfo.user,
            dbInfo.database,
          ],
          restoreEnv
        );
      }
      logger.info({ operation: "restore_db_complete", message: "Database restored" });
      await restoreInstanceIdentity(identityBefore);
    }

    // Restore files if requested. The part is known to be present and
    // readable by now — the preflight above refused the restore otherwise,
    // where it used to warn, skip, and report success (SRV-RESTORE-003).
    if (options.scope === "full" || options.scope === "files") {
      logger.info({ operation: "restore_files", message: "Restoring files" });
      const uploadsDir = path.join(__dirname, "../../../uploads");
      await extractUploadsArchive(filesBackupPath, uploadsDir);
      logger.info({ operation: "restore_files_complete", message: "Files restored" });
    }

    // A restored database carries the backup rows as they stood when the dump
    // was taken — including the row of the very backup being dumped, which was
    // still 'running' at that moment. Left alone it becomes a permanent lock:
    // further backups and restores answer 409 and the scheduler skips. The
    // route verified no operation was running before this restore began, so
    // anything in flight now came out of the archive (AUD-069).
    if (options.scope === "full" || options.scope === "database") {
      await reconcileInterruptedBackups(`restore of backup ${id}`);
    }

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });

    logger.info({
      operation: "restore_complete",
      message: "Backup restored successfully",
      backupId: id,
      scope: options.scope,
    });
  } catch (error) {
    // Cleanup on error
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    logger.error({
      operation: "restore_failed",
      message: "Restore failed",
      backupId: id,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    throw error;
  }
}
