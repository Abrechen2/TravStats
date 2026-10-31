import { formatDateTime } from "../../lib/displayFormat";
import { apiErrorMachineCode } from "../../lib/apiError";
import type { AdminService, ServiceLastTest, ServiceField } from "../../lib/api/externalServices";
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

/** The reason a test failed, in words: a known code is translated, anything else is shown as sent. */
export function testReasonText(t: TFn, reason: string | null): string {
  if (!reason) return t(`${NS}:test.noReason`);
  return t(`${NS}:test.reasons.${reason}`, { defaultValue: reason });
}

export function lastTestLine(t: TFn, lastTest: ServiceLastTest | null): string {
  if (!lastTest) return t(`${NS}:test.never`);
  const when = formatDateTime(lastTest.at);
  return lastTest.ok
    ? t(`${NS}:test.ok`, { when })
    : t(`${NS}:test.failed`, { when, reason: testReasonText(t, lastTest.reason) });
}

/** The line under a row's purpose: why it is off, or how the last test went. */
export function adminTestLine(t: TFn, service: AdminService): string {
  // "Blocked for accounts with their own key" only means something where accounts can have one.
  if (!service.enabled) {
    return t(`${NS}:test.${service.level === "instanceAndAccount" ? "offBlocks" : "offPlain"}`);
  }
  if (!service.configured) {
    return t(`${NS}:test.${service.credential === "url" ? "missingUrl" : "missingKey"}`);
  }
  return lastTestLine(t, service.lastTest);
}

/** Where the instance's credential comes from, as the row's footnote. */
export function sourceLine(t: TFn, service: AdminService): string {
  if (!service.enabled) {
    return t(`${NS}:source.${service.level === "instanceAndAccount" ? "off" : "offInstance"}`);
  }
  // A server-side variable reads like the instance's own key: the page does not speak of ENV.
  if (service.instanceSource === "instance" || service.instanceSource === "env") {
    return t(`${NS}:source.instance`);
  }
  return service.configured ? t(`${NS}:source.keyless`) : t(`${NS}:source.none`);
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
