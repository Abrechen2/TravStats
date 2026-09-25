import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { inspectRestoreArchive } from "../backupRestore";
import { ENCRYPTION_FINGERPRINT_KEY } from "../backupConfig";
import { encryptionKeyFingerprint } from "../../../utils/encryption";

/**
 * The three restore findings of the beta audit on 2026-09-20, each of which is
 * a question the restore never asked before it started writing.
 *
 * SRV-RESTORE-002 (P1): a full restore with a valid SQL part and a corrupt
 * `uploads.tar.gz` replaced the database and then died unpacking the files.
 * The error was honest; the database had already moved, and only the optional
 * safety backup could put it back.
 *
 * SRV-RESTORE-003 (P2): a FILES restore from an archive with no
 * `uploads.tar.gz` logged a warning, did nothing, and answered 200.
 *
 * SRV-RESTORE-001 (P1): the archive carries encrypted API keys and the key
 * that wrote them lives outside the archive, so a restore onto a freshly
 * initialised instance completed, reported success, and left every stored
 * credential unreadable (`hasKey=true`, `hasAccess=false`, connection test
 * 400).
 *
 * These drive the preflight directly rather than the whole restore: what was
 * missing is the QUESTION, and the psql run between extraction and unpacking
 * is not part of it.
 */

// GNU tar on Windows reads an absolute path as `host:path` and tries to
// resolve "C:" as a machine — a quirk of the developer platform, not of the
// code, which runs in a Linux container. Same reasoning as
// `uploadsRoundTrip.test.ts`; CI runs on ubuntu.
const describeOnPosix = process.platform === "win32" ? describe.skip : describe;

describeOnPosix("a restore inspects the archive before it writes", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "travstats-restore-preflight-"));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  /** A tarball that really unpacks — the "nothing wrong here" baseline. */
  const writeUsableUploads = (): void => {
    const payloadDir = path.join(workDir, "payload", "uploads", "receipts");
    fs.mkdirSync(payloadDir, { recursive: true });
    fs.writeFileSync(path.join(payloadDir, "receipt.txt"), "receipt");
    const result = spawnSync(
      "tar",
      [
        "-czf",
        path.join(workDir, "uploads.tar.gz"),
        "-C",
        path.join(workDir, "payload"),
        "uploads",
      ],
      { stdio: "ignore" }
    );
    expect(result.status).toBe(0);
    fs.rmSync(path.join(workDir, "payload"), { recursive: true, force: true });
  };

  const writeDatabasePart = (): void => {
    fs.writeFileSync(path.join(workDir, "database.sql"), "SELECT 1;\n");
  };

  const writeMetadata = (fingerprint: string | null): void => {
    const metadata: Record<string, unknown> = { instanceName: "audit" };
    if (fingerprint) metadata[ENCRYPTION_FINGERPRINT_KEY] = fingerprint;
    fs.writeFileSync(path.join(workDir, "metadata.json"), JSON.stringify(metadata));
  };

  it("finds nothing wrong with an archive that carries both readable parts", async () => {
    writeDatabasePart();
    writeUsableUploads();
    writeMetadata(encryptionKeyFingerprint());

    expect(await inspectRestoreArchive(workDir, "full")).toEqual([]);
  });

  it("refuses a full restore over a corrupt uploads archive instead of replacing the database first", async () => {
    writeDatabasePart();
    // Bytes that are not a gzip stream at all. Without the preflight this file
    // is only opened AFTER psql has already replaced the database.
    fs.writeFileSync(path.join(workDir, "uploads.tar.gz"), "this is not a tarball");

    const problems = await inspectRestoreArchive(workDir, "full");
    expect(problems.map((problem) => problem.kind)).toEqual(["unreadableFilesPart"]);
  });

  it("refuses a file restore whose archive has no file part instead of reporting success", async () => {
    writeDatabasePart();

    const problems = await inspectRestoreArchive(workDir, "files");
    expect(problems.map((problem) => problem.kind)).toEqual(["missingFilesPart"]);
  });

  it("refuses a database restore whose archive has no database part", async () => {
    writeUsableUploads();

    const problems = await inspectRestoreArchive(workDir, "database");
    expect(problems.map((problem) => problem.kind)).toEqual(["missingDatabasePart"]);
  });

  it("names the encryption key when the archive's encrypted values cannot be read here", async () => {
    writeDatabasePart();
    writeUsableUploads();
    writeMetadata("0123456789abcdef");

    const problems = await inspectRestoreArchive(workDir, "full");
    expect(problems).toEqual([
      {
        kind: "encryptionKeyMismatch",
        archiveFingerprint: "0123456789abcdef",
        ownFingerprint: encryptionKeyFingerprint(),
      },
    ]);
  });

  it("says nothing about the encryption key when the archive predates the fingerprint", async () => {
    // Every archive written before this check existed. An absent answer is not
    // a wrong one, and refusing those would be a worse bug than the one the
    // check prevents.
    writeDatabasePart();
    writeUsableUploads();
    writeMetadata(null);

    expect(await inspectRestoreArchive(workDir, "full")).toEqual([]);
  });

  it("ignores the encryption key for a files-only restore, which decrypts nothing", async () => {
    writeUsableUploads();
    writeMetadata("0123456789abcdef");

    expect(await inspectRestoreArchive(workDir, "files")).toEqual([]);
  });
});
