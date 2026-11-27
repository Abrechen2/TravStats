/**
 * Imported FIRST by the recovery-key suites: points the secrets directory at a
 * fresh temporary folder holding a known key file, before any module reads it,
 * and clears ENCRYPTION_KEY so the key counts as file-held (only a file-held
 * key can be replaced by a restore).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const KEY_A = "a1".repeat(32);
export const SECRETS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "travstats-recovery-key-"));

fs.writeFileSync(path.join(SECRETS_DIR, "encryption.key"), KEY_A, { mode: 0o600 });
process.env.SECRETS_DIR = SECRETS_DIR;
delete process.env.ENCRYPTION_KEY;
