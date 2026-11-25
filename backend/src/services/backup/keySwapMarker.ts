/**
 * The record of a key swap in progress (`restoreRecoveryKey.ts`).
 *
 * A restore with the archive's recovery key installs that key immediately
 * before the dump replays. Between those two steps the key file and the
 * database disagree: if the process dies there — a crash, an OOM kill, a
 * container restart — the server comes back with one key in force and rows
 * that may be under the other. Which one is right depends on how far psql got,
 * and nothing at boot can tell that for certain.
 *
 * So the swap writes this marker before it touches the key and removes it only
 * once key and rows agree again (the replay and the re-encryption finished, or
 * the failed replay's old key is back). A marker found at boot means the swap
 * died half-way: it is logged loudly, it raises the `admin.keySwapInterrupted`
 * readiness item, and a new key restore is refused until an admin has decided.
 * The key file is never changed here — picking a key silently is exactly the
 * mistake that would make every stored credential unreadable.
 *
 * The marker names paths and fingerprints only, never a key.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import logger from "../../utils/logger";
import { encryptionKeyFilePath, activeEncryptionKeyHex } from "../../utils/encryptionKey";
import { encryptionKeyFingerprintFor } from "../../utils/encryption";

export interface KeySwapMarker {
  /** The copy of the key in force before the swap (`encryption.key.before-restore-*`). */
  readonly previousKeyCopy: string;
  readonly previousFingerprint: string;
  readonly archiveFingerprint: string;
  readonly startedAt: string;
}

export interface InterruptedKeySwap extends KeySwapMarker {
  readonly previousKeyCopyExists: boolean;
  /** Which of the two keys the key file holds now, or `other` / `unreadable`. */
  readonly inForce: "previous" | "archive" | "other" | "unreadable";
}

export function keySwapMarkerPath(): string {
  return `${encryptionKeyFilePath()}.restore-pending`;
}

/** Written before the key file changes; `wx` so a second swap never overwrites the first's record. */
export function writeKeySwapMarker(marker: KeySwapMarker): void {
  writeFileSync(keySwapMarkerPath(), JSON.stringify(marker), { mode: 0o600, flag: "wx" });
}

/** Key and rows agree again. A failed removal is logged: the next boot will report a swap that did finish. */
export function clearKeySwapMarker(): void {
  try {
    rmSync(keySwapMarkerPath(), { force: true });
  } catch (error) {
    logger.error({
      operation: "restore_key_swap_marker_clear_failed",
      message: "Could not remove the key-swap marker; the next start will report an interrupted swap",
      marker: keySwapMarkerPath(),
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

function inForce(marker: KeySwapMarker): InterruptedKeySwap["inForce"] {
  try {
    const now = encryptionKeyFingerprintFor(activeEncryptionKeyHex());
    if (now === marker.previousFingerprint) return "previous";
    if (now === marker.archiveFingerprint) return "archive";
    return "other";
  } catch {
    return "unreadable";
  }
}

/**
 * The swap that did not finish, or null. A marker that cannot be parsed still
 * counts: its existence is the signal, and an unreadable one is no reason to
 * assume the swap completed.
 */
export function readInterruptedKeySwap(): InterruptedKeySwap | null {
  const file = keySwapMarkerPath();
  if (!existsSync(file)) return null;
  let marker: KeySwapMarker;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as Partial<KeySwapMarker>;
    marker = {
      previousKeyCopy: String(parsed.previousKeyCopy ?? ""),
      previousFingerprint: String(parsed.previousFingerprint ?? ""),
      archiveFingerprint: String(parsed.archiveFingerprint ?? ""),
      startedAt: String(parsed.startedAt ?? ""),
    };
  } catch {
    marker = { previousKeyCopy: "", previousFingerprint: "", archiveFingerprint: "", startedAt: "" };
  }
  return {
    ...marker,
    previousKeyCopyExists: marker.previousKeyCopy !== "" && existsSync(marker.previousKeyCopy),
    inForce: inForce(marker),
  };
}

/**
 * At start: report a key swap a dead restore left behind. Reports only — the
 * key file stays as it is (see the header), and the admin decides.
 */
export function reconcileKeySwapAtBoot(): InterruptedKeySwap | null {
  const interrupted = readInterruptedKeySwap();
  if (!interrupted) return null;
  logger.error({
    operation: "restore_key_swap_interrupted",
    message:
      "A restore died while replacing the encryption key. The key file was NOT changed at start: " +
      "if the database replay did not finish, copy previousKeyCopy over the encryption.key file; " +
      "if it did, keep the key in force. Then delete the marker file and restart.",
    marker: keySwapMarkerPath(),
    previousKeyCopy: interrupted.previousKeyCopy,
    previousKeyCopyExists: interrupted.previousKeyCopyExists,
    keyInForce: interrupted.inForce,
    startedAt: interrupted.startedAt,
  });
  return interrupted;
}
