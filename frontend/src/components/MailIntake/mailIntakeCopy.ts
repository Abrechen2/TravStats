type TFunction = (key: string, options?: Record<string, unknown>) => string;

import { profileWallClock } from "../../lib/profileInstant";
import { MAIL_REASONS, MAIL_SOURCE_ERRORS, mailIntakeErrorCode } from "../../lib/api/mailIntake";

/** ISO instant → "2026-11-02 14:05" on the profile clock. */
export function minuteOf(iso: string): string {
  const local = profileWallClock(iso);
  return local ? `${local.slice(0, 10)} ${local.slice(11, 16)}` : iso;
}

/** A source failure kind or a refused request's code, in words; never a raw code. */
export function errorText(t: TFunction, kind: string | null, fallbackKey: string): string {
  if (kind && (MAIL_SOURCE_ERRORS as readonly string[]).includes(kind)) {
    return t(`mailIntake:errors.${kind}`);
  }
  if (kind === "MAIL_HOST_BLOCKED" || kind === "MAIL_INTAKE_OFF")
    return t(`mailIntake:errors.${kind}`);
  return t(fallbackKey);
}

export function requestErrorText(
  t: TFunction,
  err: unknown,
  fallbackKey = "mailIntake:saveError"
): string {
  return errorText(t, mailIntakeErrorCode(err), fallbackKey);
}

export function reasonText(t: TFunction, reason: string | null): string {
  return reason && (MAIL_REASONS as readonly string[]).includes(reason)
    ? t(`mailIntake:reasons.${reason}`)
    : t("mailIntake:inbox.actionError");
}

/**
 * Why a mailbox-scan action failed, in words: a mailbox failure kind (`auth_failed`,
 * `folder_missing`, `unreachable`, …) reads like the settings card, a request code
 * (`MAIL_SCAN_RUNNING`, …) or a lost job has its own sentence.
 */
export function scanFailureReason(t: TFunction, code: string | null): string {
  if (code && (MAIL_SOURCE_ERRORS as readonly string[]).includes(code)) {
    return t(`mailIntake:errors.${code}`);
  }
  return t(`mailIntake:scan.errors.${code ?? "unknown"}`, {
    defaultValue: t("mailIntake:scan.errors.unknown"),
  });
}
