/**
 * "Verbindung testen" (forgejo#392): runs the EXISTING tester of a service
 * against the credential it would really use, and persists the verdict so the
 * page can show "last tested" without calling out again.
 *
 * A switched-off service is not called (409 SERVICE_DISABLED) — the one
 * exception is a cloud AI provider that is only waiting for the admin's
 * consent: its probe carries a key and no document, and an admin needs it
 * before deciding (same rule the old per-slot test followed).
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { decryptApiKey } from "../../utils/encryption";
import { testConnection as testWebDAVConnection } from "../cloudSyncService";
import { testDawarichConnection } from "../dawarich/dawarichTester";
import { testImmichConnection } from "../immich/immichTester";
import { testPhotoprismConnection } from "../photoprism/photoprismTester";
import { accountMayReachPrivate } from "../egress/privateTargets";
import {
  ANTHROPIC_BASE_URL,
  GOOGLE_BASE_URL,
  OPENAI_BASE_URL,
  llmProbe,
  ollamaTarget,
  type LlmTarget,
} from "../llm/llmProvider";
import {
  testAirlabsKey,
  testAviationstackKey,
  testAerodataboxKey,
  testGooglePlacesKey,
  testGraphHopperKey,
  testLogostreamKey,
  testOpenRouteServiceKey,
  testOpenSkyCredentials,
  type ApiKeyTestResult,
} from "../apiKeyTester";
import { testAdsbLolKey, testAdsbxKey, testAirplanesLive } from "../apiKeyTesterAdsbx";
import { testAeroapiKey } from "../apiKeyTesterAeroapi";
import { getService } from "./catalogue";
import { loadAdminState, isEnabled } from "./adminView";
import { offReasonFor } from "./policy";
import { recordTest, type LastTest } from "./tests";
import type { FieldDef, ServiceDef } from "./types";

export interface TestOutcome {
  ok: boolean;
  reason: string | null;
  /** Whether the test spent provider quota (metered APIs answer a real request). */
  usedQuota: boolean;
  /** Whose credential was used; "none" when nothing was called. */
  source: "account" | "instance" | "none";
  lastTest: LastTest | null;
}

/** Testers that answer a real, metered API request. */
const METERED = new Set([
  "airlabs",
  "aviationstack",
  "aerodatabox",
  "aeroapi",
  "adsbx",
  "googlePlaces",
  "openrouteservice",
  "graphhopper",
]);

type Row = Record<string, unknown> | null;

/** The plain value of a field; a secret is decrypted, an empty one is null. */
function plain(field: FieldDef | undefined, row: Row): string | null {
  if (!field) return null;
  const raw = row?.[field.column];
  if (typeof raw !== "string" || raw === "") return null;
  return field.kind === "secret" ? decryptApiKey(raw) : raw;
}

function creds(defs: readonly FieldDef[], row: Row): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of defs) out[f.key] = plain(f, row);
  return out;
}

/** Stable cause codes for `lastTest.reason` (the page words them, never the server). */
export const TEST_REASONS = [
  "auth",
  "quota",
  "timeout",
  "network",
  "http_error",
  "not_found",
  "not_configured",
  "no_instance_key",
  "http_404",
  "disabled",
  "unknown",
] as const;
export type TestReason = (typeof TEST_REASONS)[number];

const REASON_BY_KEY: Record<string, TestReason> = {
  invalid: "auth",
  noKey: "auth",
  // "Nothing to test" is not "nothing found at the address".
  notConfigured: "not_configured",
  noInstanceKey: "no_instance_key",
  notFound: "http_404",
  notTestable: "unknown",
  openskyMissingCredentials: "auth",
  openskyInvalid: "auth",
  rateLimited: "quota",
  unreachable: "network",
  unexpectedStatus: "http_error",
  providerError: "http_error",
  protocol: "http_error",
  auth: "auth",
  invalidUrl: "not_found",
  timeout: "timeout",
};

export function toReasonCode(raw: string | null | undefined): TestReason {
  return (raw && REASON_BY_KEY[raw]) || "unknown";
}

/** A provider's HTTP 404 has its own reason: neither "unexpected answer" nor "no such address". */
function keyFailureReason(r: ApiKeyTestResult): TestReason {
  if (r.messageKey === "unexpectedStatus" && Number(r.messageParams?.status) === 404) {
    return "http_404";
  }
  return toReasonCode(r.messageKey);
}

const notConfigured = (): ApiKeyTestResult => ({
  success: false,
  message: "No credential configured to test.",
  messageKey: "notConfigured",
});

async function run(
  service: ServiceDef,
  c: Record<string, string | null>,
  userId?: string
): Promise<{ ok: boolean; reason: string | null }> {
  const fromKeyResult = (r: ApiKeyTestResult) => ({
    ok: r.success,
    reason: r.success ? null : keyFailureReason(r),
  });
  const keyed = async (fn: (k: string, u?: string) => Promise<ApiKeyTestResult>) =>
    fromKeyResult(c.apiKey ? await fn(c.apiKey, userId) : notConfigured());

  switch (service.tester) {
    case "airlabs":
      return keyed(testAirlabsKey);
    case "aviationstack":
      return keyed(testAviationstackKey);
    case "aerodatabox":
      return keyed(testAerodataboxKey);
    case "aeroapi":
      return keyed(testAeroapiKey);
    case "adsbx":
      return keyed(testAdsbxKey);
    case "adsblol":
      // Keyless: the tester accepts an empty key.
      return fromKeyResult(await testAdsbLolKey(c.apiKey ?? "", userId));
    case "airplaneslive":
      return fromKeyResult(await testAirplanesLive());
    case "googlePlaces":
      return keyed(testGooglePlacesKey);
    case "openrouteservice":
      return keyed(testOpenRouteServiceKey);
    case "graphhopper":
      return keyed(testGraphHopperKey);
    case "logostream":
      return keyed(testLogostreamKey);
    case "opensky":
      return fromKeyResult(
        await testOpenSkyCredentials(
          {
            clientId: c.clientId ?? undefined,
            clientSecret: c.clientSecret ?? undefined,
            username: c.username ?? undefined,
            password: c.password ?? undefined,
          },
          userId
        )
      );
    case "photoprism": {
      if (!c.baseUrl || !c.token) return { ok: false, reason: "not_configured" };
      const policy = { allowPrivate: userId ? await accountMayReachPrivate(userId) : true };
      const r = await testPhotoprismConnection(c.baseUrl, c.token, policy);
      return { ok: r.success, reason: r.success ? null : toReasonCode(r.kind) };
    }
    case "immich":
    case "dawarich": {
      if (!c.baseUrl || !c.apiKey) return { ok: false, reason: "not_configured" };
      // The instance credential keeps LAN access; an account's own one only
      // when the account is an admin (forgejo#411).
      const policy = { allowPrivate: userId ? await accountMayReachPrivate(userId) : true };
      const r =
        service.tester === "immich"
          ? await testImmichConnection(c.baseUrl, c.apiKey, policy)
          : await testDawarichConnection(c.baseUrl, c.apiKey, policy);
      return { ok: r.success, reason: r.success ? null : toReasonCode(r.kind) };
    }
    case "webdav": {
      const r = await testWebDAVConnection();
      return { ok: r.success, reason: r.success ? null : "network" };
    }
    case "ollama":
    case "llmCloud": {
      const target = llmTarget(service, c);
      if (!target) return { ok: false, reason: "not_configured" };
      const probe = await llmProbe(target);
      const auth = /HTTP 40[13]\b/.test(probe.error ?? "");
      return {
        ok: probe.reachable,
        reason: probe.reachable ? null : auth ? "auth" : "network",
      };
    }
    default:
      return { ok: false, reason: "unknown" };
  }
}

function llmTarget(service: ServiceDef, c: Record<string, string | null>): LlmTarget | null {
  const kind = service.ai?.kind;
  if (kind === "ollama") return c.url ? ollamaTarget(c.url, c.model ?? undefined) : null;
  if (kind === "custom") {
    if (!c.baseUrl) return null;
    return {
      kind,
      url: c.baseUrl,
      model: c.model ?? "",
      ...(c.apiKey ? { apiKey: c.apiKey } : {}),
      isCloud: true,
    };
  }
  if (!kind || !c.apiKey) return null;
  const url =
    kind === "openai"
      ? OPENAI_BASE_URL
      : kind === "anthropic"
        ? ANTHROPIC_BASE_URL
        : GOOGLE_BASE_URL;
  return { kind, url, model: c.model ?? "", apiKey: c.apiKey, isCloud: true };
}

const disabled = (): AppError =>
  new AppError("This service is switched off; nothing was called", 409, "SERVICE_DISABLED");

/** Does the instance (admin) columns hold everything the service requires? */
function instanceHasCredential(service: ServiceDef, admin: Row): boolean {
  return (
    service.requiredFields.length > 0 &&
    service.requiredFields.every((key) => {
      const f = service.fields.find((x) => x.key === key);
      return f
        ? plain(f, admin) !== null || (f.kind === "switch" && admin?.[f.column] === true)
        : false;
    })
  );
}

/**
 * Admin test. By default it tests the INSTANCE credential; with an empty
 * instance column it says so ("noInstanceKey") instead of probing. With
 * `effective` it tests the key a request of this admin would really use, and
 * names whose it was (the account's own first, then the instance's).
 */
export async function testInstanceService(
  id: string,
  opts: { effective?: boolean; userId?: string } = {}
): Promise<TestOutcome> {
  const service = getService(id);
  if (!service) throw new AppError("Unknown external service", 404, "SERVICE_NOT_FOUND");
  const state = await loadAdminState();
  const waitingForConsent = service.ai !== undefined && service.enabled.kind === "adminColumns";
  if (!isEnabled(service, state) && !waitingForConsent) throw disabled();
  if (state.policy.disabled.includes(id)) throw disabled();

  if (!service.tester) {
    return { ok: false, reason: "unknown", usedQuota: false, source: "none", lastTest: null };
  }
  const metered = METERED.has(service.tester);
  if (opts.effective && opts.userId) {
    const row = (await prisma.userSettings.findUnique({ where: { userId: opts.userId } })) as Row;
    const own = creds(service.accountFields, row);
    const ownHas =
      service.requiredFields.length > 0 &&
      service.requiredFields.every((k) => own[k] !== undefined && own[k] !== null) &&
      !state.policy.accountKeysForbidden.includes(id);
    if (ownHas) {
      const outcome = await run(service, own, opts.userId);
      const lastTest = await recordTest(opts.userId, id, outcome.ok, outcome.reason);
      return { ...outcome, usedQuota: metered, source: "account", lastTest };
    }
  }
  if (
    !service.keyless &&
    service.requiredFields.length > 0 &&
    !instanceHasCredential(service, state.admin)
  ) {
    // Nothing is probed and nothing is recorded: there was no test.
    return {
      ok: false,
      reason: "no_instance_key",
      usedQuota: false,
      source: "none",
      lastTest: null,
    };
  }
  const outcome = await run(service, creds(service.fields, state.admin));
  const lastTest = await recordTest(null, id, outcome.ok, outcome.reason);
  return { ...outcome, usedQuota: metered, source: "instance", lastTest };
}

/**
 * Account test: the credential that is EFFECTIVE for this account - its own
 * when it set one (and the admin allows it), otherwise the instance's. The
 * outcome names which one was tested; with neither, nothing is called.
 */
export async function testAccountService(id: string, userId: string): Promise<TestOutcome> {
  const service = getService(id);
  if (!service || service.accountFields.length === 0) {
    throw new AppError("Unknown external service", 404, "SERVICE_NOT_FOUND");
  }
  if (await offReasonFor(id, userId)) throw disabled();
  if (!service.tester) {
    return { ok: false, reason: "unknown", usedQuota: false, source: "none", lastTest: null };
  }
  const state = await loadAdminState();
  const row = (await prisma.userSettings.findUnique({ where: { userId } })) as Row;
  const own = creds(service.accountFields, row);
  const ownHas =
    service.requiredFields.length > 0 &&
    service.requiredFields.every((k) => own[k] !== undefined && own[k] !== null) &&
    !state.policy.accountKeysForbidden.includes(id);
  const metered = METERED.has(service.tester);
  if (ownHas) {
    const outcome = await run(service, own, userId);
    const lastTest = await recordTest(userId, id, outcome.ok, outcome.reason);
    return { ...outcome, usedQuota: metered, source: "account", lastTest };
  }
  if (instanceHasCredential(service, state.admin)) {
    // The instance credential keeps the server's reach (no account egress policy).
    const outcome = await run(service, creds(service.fields, state.admin));
    const lastTest = await recordTest(userId, id, outcome.ok, outcome.reason);
    return { ...outcome, usedQuota: metered, source: "instance", lastTest };
  }
  const outcome = await run(service, own, userId);
  const lastTest = await recordTest(userId, id, outcome.ok, outcome.reason);
  return { ...outcome, usedQuota: metered, source: "none", lastTest };
}
