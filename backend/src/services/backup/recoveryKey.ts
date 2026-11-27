/**
 * The instance recovery key (owner request, 2026-11-24).
 *
 * A backup — local or WebDAV — carries the database, and with it every API key,
 * SMTP password and Immich/Dawarich token, encrypted under the instance key in
 * `/app/data/secrets/encryption.key`. That key is deliberately NOT in the
 * archive (SRV-RESTORE-001 in `backupRestore.ts`): an archive that carried its
 * own key would hand every credential to whoever holds a copy. The price is
 * that a server lost together with its key restores to data whose credentials
 * nothing can read. So the admin has to keep the key somewhere else, and this
 * module is how the instance makes sure one did:
 *
 * - `revealRecoveryKey` shows it, once per call, after a fresh re-authentication
 *   (password + second factor, or a passkey assertion);
 * - `confirmRecoveryKey` takes the LAST FOUR characters back — never the whole
 *   key, so the confirm call is not a second way to read or test it — compares
 *   them in constant time, and records which key the confirmation was for;
 * - `recoveryKeyStatus` says whether an instance with an off-site backup target
 *   still owes that confirmation. A confirmation for another fingerprint (the
 *   key changed since) does not count.
 *
 * The key itself never reaches a log line, an error body or the database; the
 * audit trail records that it was shown or confirmed, and by whom.
 */
import * as crypto from "crypto";

import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { securityLogger } from "../../utils/logger";
import { activeEncryptionKeyHex, encryptionKeyPinnedByEnv } from "../../utils/encryptionKey";
import { encryptionKeyFingerprint } from "../../utils/encryption";
import { ensureAdminSettings, getInstanceSettings } from "../instanceSettingsService";

/** Characters per group in the displayed key. */
export const RECOVERY_KEY_GROUP_SIZE = 4;
/** How many trailing characters the confirm step asks for. */
export const RECOVERY_KEY_CONFIRM_LENGTH = 4;
/** A confirm must follow a reveal by the same admin within this window. */
export const RECOVERY_KEY_REVEAL_WINDOW_MS = 30 * 60 * 1000;

const revealedAt = new Map<string, number>();

/** For tests: forget every reveal. */
export function resetRecoveryKeyReveals(): void {
  revealedAt.clear();
}

/** "A1B2 C3D4 …" — upper-case hex in groups of four. */
export function formatRecoveryKey(keyHex: string): string {
  const upper = keyHex.toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < upper.length; i += RECOVERY_KEY_GROUP_SIZE) {
    groups.push(upper.slice(i, i + RECOVERY_KEY_GROUP_SIZE));
  }
  return groups.join(" ");
}

/** The 64 lower-case hex characters a pasted key stands for, or null. Spaces,
 *  dashes and line breaks from copying the grouped form are ignored. */
export function normalizeRecoveryKey(input: string): string | null {
  const compact = input.replace(/[\s-]+/g, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(compact) ? compact : null;
}

/** A filesystem-safe slug of the instance name for the download's filename. */
function instanceSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 40);
  return slug || "travstats";
}

export interface RecoveryKeyStatus {
  /** An off-site (WebDAV) backup target is configured. */
  backupTargetConfigured: boolean;
  /** A confirmation exists for the key now in force. */
  confirmed: boolean;
  confirmedAt: string | null;
  /** A confirmation exists, but for a key that has since been replaced. */
  confirmedForOtherKey: boolean;
  /** The admin owes the confirmation: a target exists and the key is not confirmed. */
  required: boolean;
  /** The key comes from the ENCRYPTION_KEY environment variable. */
  pinnedByEnv: boolean;
}

/** Is a stored confirmation one for the key now in force? */
export function isConfirmedForCurrentKey(row: {
  recoveryKeyConfirmedAt: Date | null;
  recoveryKeyFingerprint: string | null;
}): boolean {
  return (
    row.recoveryKeyConfirmedAt !== null &&
    row.recoveryKeyFingerprint !== null &&
    row.recoveryKeyFingerprint === encryptionKeyFingerprint()
  );
}

/** The same rule `readiness/context.ts` uses for `offsiteConfigured`. */
export function hasBackupTarget(row: {
  webdavSyncEnabled: boolean;
  webdavUrl: string | null;
}): boolean {
  return Boolean(row.webdavSyncEnabled && row.webdavUrl);
}

export async function recoveryKeyStatus(): Promise<RecoveryKeyStatus> {
  const row = await ensureAdminSettings();
  const backupTargetConfigured = hasBackupTarget(row);
  const confirmed = isConfirmedForCurrentKey(row);
  return {
    backupTargetConfigured,
    confirmed,
    confirmedAt:
      confirmed && row.recoveryKeyConfirmedAt ? row.recoveryKeyConfirmedAt.toISOString() : null,
    confirmedForOtherKey: !confirmed && row.recoveryKeyConfirmedAt !== null,
    required: backupTargetConfigured && !confirmed,
    pinnedByEnv: encryptionKeyPinnedByEnv(),
  };
}

export interface RevealedRecoveryKey {
  /** The key in groups of four. Shown once; never stored or logged. */
  key: string;
  fingerprint: string;
  instanceName: string;
  filename: string;
}

/**
 * The key, for an admin who has just re-authenticated (the route does that).
 * Remembers the reveal so the confirm step can insist on one.
 */
export async function revealRecoveryKey(userId: string): Promise<RevealedRecoveryKey> {
  const keyHex = activeEncryptionKeyHex();
  const { instanceName } = await getInstanceSettings();
  revealedAt.set(userId, Date.now());
  securityLogger.info({
    operation: "security_event",
    event: "recovery_key_shown",
    userId,
  });
  return {
    key: formatRecoveryKey(keyHex),
    fingerprint: encryptionKeyFingerprint(),
    instanceName,
    filename: `travstats-recovery-key-${instanceSlug(instanceName)}.txt`,
  };
}

/**
 * Check the last four characters against the key in force, in constant time,
 * and record the confirmation for this key's fingerprint.
 */
export async function confirmRecoveryKey(
  userId: string,
  lastFour: string
): Promise<{ confirmedAt: string }> {
  const at = revealedAt.get(userId);
  if (at === undefined || Date.now() - at > RECOVERY_KEY_REVEAL_WINDOW_MS) {
    revealedAt.delete(userId);
    throw new AppError(
      "Show the recovery key before confirming it",
      409,
      "RECOVERY_KEY_NOT_REVEALED"
    );
  }
  const given = Buffer.from(lastFour.replace(/\s+/g, "").toLowerCase(), "utf8");
  if (given.length !== RECOVERY_KEY_CONFIRM_LENGTH) {
    throw new AppError(
      `Enter exactly ${RECOVERY_KEY_CONFIRM_LENGTH} characters`,
      400,
      "RECOVERY_KEY_CONFIRM_FORMAT"
    );
  }
  const expected = Buffer.from(
    activeEncryptionKeyHex().slice(-RECOVERY_KEY_CONFIRM_LENGTH),
    "utf8"
  );
  if (!crypto.timingSafeEqual(given, expected)) {
    securityLogger.warn({
      operation: "security_event",
      event: "recovery_key_confirm_mismatch",
      userId,
    });
    throw new AppError(
      "Those are not the last characters of the recovery key",
      422,
      "RECOVERY_KEY_CONFIRM_MISMATCH"
    );
  }
  const row = await ensureAdminSettings();
  const confirmedAt = new Date();
  await prisma.adminSettings.update({
    where: { id: row.id },
    data: {
      recoveryKeyConfirmedAt: confirmedAt,
      recoveryKeyFingerprint: encryptionKeyFingerprint(),
    },
  });
  revealedAt.delete(userId);
  securityLogger.info({
    operation: "security_event",
    event: "recovery_key_confirmed",
    userId,
  });
  return { confirmedAt: confirmedAt.toISOString() };
}
