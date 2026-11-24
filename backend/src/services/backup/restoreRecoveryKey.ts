/**
 * A restore that was handed the archive instance's recovery key
 * (`services/backup/recoveryKey.ts`).
 *
 * Without it, an archive written under another instance key either is refused
 * (RESTORE_ENCRYPTION_KEY_MISMATCH) or restores with every stored credential
 * unreadable, if the admin acknowledged that. With it, the pasted key is checked
 * against the fingerprint in the archive's `metadata.json` BEFORE anything is
 * written, and installed as this instance's key immediately before the dump is
 * replayed — so the restored ciphertext and the key in force agree again.
 *
 * Three things here are about not making the situation worse:
 * - the key is installed AFTER the safety backup, which must still be written
 *   (and fingerprinted) under the key its rows were encrypted with;
 * - a dump replay that fails puts the previous key back — psql rolled the
 *   database back, so its rows are still under the old key;
 * - the instance identity the restore keeps from BEFORE the dump (federation
 *   private key, push relay secret, see `restoreAftermath.ts`) was encrypted
 *   under the old key, so it is re-encrypted under the new one afterwards.
 *
 * The key never appears in a log line or an error message.
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import {
  activeEncryptionKeyHex,
  encryptionKeyPinnedByEnv,
  installEncryptionKey,
} from "../../utils/encryptionKey";
import { decryptApiKey, encryptApiKey, encryptionKeyFingerprintFor } from "../../utils/encryption";
import { normalizeRecoveryKey } from "./recoveryKey";

/** Instance-identity columns kept across a restore that hold ciphertext. */
const ENCRYPTED_IDENTITY_COLUMNS = ["federationPrivateKey", "pushInstanceSecret"] as const;
type EncryptedIdentityColumn = (typeof ENCRYPTED_IDENTITY_COLUMNS)[number];

export interface KeySwap {
  readonly archiveKeyHex: string;
  readonly previousKeyHex: string;
  readonly identityPlain: Readonly<Record<EncryptedIdentityColumn, string | null>>;
}

export function invalidRecoveryKey(): AppError {
  return new AppError(
    "The recovery key must be 64 hexadecimal characters (spaces are ignored).",
    400,
    "RESTORE_RECOVERY_KEY_INVALID"
  );
}

/**
 * The 64 hex characters of a pasted key that provably wrote this archive.
 * Refuses a malformed key, a key with another fingerprint, and an instance
 * whose key the environment pins (a file write would not survive a restart).
 */
export function resolveArchiveRecoveryKey(input: string, archiveFingerprint: string): string {
  const keyHex = normalizeRecoveryKey(input);
  if (!keyHex) throw invalidRecoveryKey();
  if (encryptionKeyFingerprintFor(keyHex) !== archiveFingerprint) {
    throw new AppError(
      "This recovery key is not the key that wrote the archive. Nothing was restored.",
      400,
      "RESTORE_RECOVERY_KEY_WRONG"
    );
  }
  if (encryptionKeyPinnedByEnv()) {
    throw new AppError(
      "The encryption key of this instance is set by the ENCRYPTION_KEY environment variable. " +
        "Set it to the recovery key there and restart, then restore again. Nothing was restored.",
      409,
      "RESTORE_RECOVERY_KEY_ENV_PINNED"
    );
  }
  return keyHex;
}

/** Read what has to survive the swap while the old key still decrypts it. */
export async function prepareKeySwap(archiveKeyHex: string): Promise<KeySwap> {
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { federationPrivateKey: true, pushInstanceSecret: true },
  });
  return {
    archiveKeyHex,
    previousKeyHex: activeEncryptionKeyHex(),
    identityPlain: {
      federationPrivateKey: decryptApiKey(row?.federationPrivateKey),
      pushInstanceSecret: decryptApiKey(row?.pushInstanceSecret),
    },
  };
}

/** Install the archive's key. A failed write refuses the restore before psql runs. */
export function installArchiveKey(swap: KeySwap): void {
  try {
    installEncryptionKey(swap.archiveKeyHex);
  } catch (error) {
    logger.error({
      operation: "restore_recovery_key_write_failed",
      message: "Could not write the recovery key to the secrets directory",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      "The recovery key could not be written to the secrets directory. Nothing was restored.",
      500,
      "RESTORE_RECOVERY_KEY_WRITE_FAILED"
    );
  }
  logger.warn({
    operation: "restore_recovery_key_installed",
    message: "The archive's recovery key replaced this instance's encryption key for the restore",
  });
}

/** The dump replay failed and was rolled back: its rows are still under the old key. */
export function revertKeySwap(swap: KeySwap): void {
  try {
    installEncryptionKey(swap.previousKeyHex);
    logger.warn({
      operation: "restore_recovery_key_reverted",
      message: "The restore failed; the previous encryption key is back in force",
    });
  } catch (error) {
    logger.error({
      operation: "restore_recovery_key_revert_failed",
      message:
        "The restore failed AND the previous encryption key could not be written back; " +
        "stored credentials will not decrypt until the secrets file is repaired",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/** Re-encrypt the kept instance identity under the key now in force. */
export async function reencryptKeptIdentity(swap: KeySwap): Promise<void> {
  const data: Partial<Record<EncryptedIdentityColumn, string | null>> = {};
  for (const column of ENCRYPTED_IDENTITY_COLUMNS) {
    const plain = swap.identityPlain[column];
    if (plain !== null) data[column] = encryptApiKey(plain);
  }
  if (Object.keys(data).length === 0) return;
  await prisma.adminSettings.updateMany({ data });
}
