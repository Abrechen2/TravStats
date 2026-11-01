import { formatDateTime } from "../../lib/displayFormat";
import { apiErrorMachineCode } from "../../lib/apiError";
import type { ServiceLastTest, ServiceField } from "../../lib/api/externalServices";
import { EXTERNAL_SERVICE_ERROR_CODES } from "../../lib/api/externalServices";
import { adminStatus } from "./serviceStatus";

export type TFn = (key: string, options?: Record<string, unknown>) => string;

const NS = "externalServices";
const MISSING = "\u0000missing";

/** Copy of one catalogue entry; a service the copy does not know yet reads as its id, never as a key. */
export function serviceCopy(t: TFn, id: string, part: string, fallback = ""): string {
  return t(`${NS}:services.${id}.${part}`, { defaultValue: fallback });
}

/** Services whose admin row is the instance part of something accounts also connect. */
const ADMIN_PURPOSE_IDS: ReadonlySet<string> = new Set(["immich", "strava", "webdav"]);

/** The admin row's purpose: the instance's part, where it differs from the account's. */
export function adminPurpose(t: TFn, id: string): string {
  return serviceCopy(t, id, ADMIN_PURPOSE_IDS.has(id) ? "adminPurpose" : "purpose");
}

export function serviceName(t: TFn, id: string): string {
  return serviceCopy(t, id, "name", id);
}

/** A field's label: the service's own wording, then the common one, then the raw key. */
export function fieldLabel(t: TFn, serviceId: string, field: Pick<ServiceField, "key">): string {
  // i18next answers an EMPTY defaultValue with the key itself, so a miss needs a sentinel to be told apart.
  const own = t(`${NS}:fields.${serviceId}.${field.key}`, { defaultValue: MISSING });
  if (own !== MISSING) return own;
  return t(`${NS}:fields.common.${field.key}`, { defaultValue: field.key });
}

/** A select option's label; an option the copy does not know shows as the stored value. */
export function optionLabel(t: TFn, serviceId: string, fieldKey: string, option: string): string {
  return t(`${NS}:fieldOptions.${serviceId}.${fieldKey}.${option}`, { defaultValue: option });
}

/** The reason a test failed, in words: a known code is translated, anything else is shown as sent. */
export function testReasonText(t: TFn, reason: string | null): string {
  if (!reason) return t(`${NS}:test.noReason`);
  return t(`${NS}:test.reasons.${reason}`, { defaultValue: reason });
}

/**
 * A failed test in the design's own voice (§5.8): one sentence, first person,
 * no "Fehler". A reason the copy does not know reads as the unknown one.
 */
export function reasonSentence(t: TFn, reason: string | null, name: string): string {
  const key = `settingsRows:services.reason.${reason ?? "unknown"}`;
  const text = t(key, { name, defaultValue: MISSING });
  return text === MISSING ? t("settingsRows:services.reason.unknown", { name }) : text;
}

export function lastTestLine(t: TFn, lastTest: ServiceLastTest | null): string {
  if (!lastTest) return t(`${NS}:test.never`);
  const when = formatDateTime(lastTest.at);
  return lastTest.ok
    ? t(`${NS}:test.ok`, { when })
    : t(`${NS}:test.failed`, { when, reason: testReasonText(t, lastTest.reason) });
}

export function statusLabel(t: TFn, status: ReturnType<typeof adminStatus>): string {
  return t(`${NS}:status.${status}`);
}

/**
 * A failed call as the user should read it. The server sends a stable code
 * (`{ error, code }`); an English sentence from it would land raw in the German
 * UI. No response at all is a network problem, which is its own message.
 */
export function failureText(t: TFn, err: unknown, fallbackKey = "errors.generic"): string {
  const code = apiErrorMachineCode(err);
  if (code && (EXTERNAL_SERVICE_ERROR_CODES as readonly string[]).includes(code)) {
    return t(`${NS}:errors.${code}`);
  }
  const response = (err as { response?: unknown } | null)?.response;
  if (response === undefined) return t(`${NS}:errors.network`);
  return t(`${NS}:${fallbackKey}`);
}

export function isServiceDisabledError(err: unknown): boolean {
  return apiErrorMachineCode(err) === "SERVICE_DISABLED";
}
