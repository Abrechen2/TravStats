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
import { testAdsbLolKey, testAdsbxKey } from "../apiKeyTesterAdsbx";
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

const ENV_BY_FIELD: Record<string, Record<string, string>> = {
  immich: { baseUrl: "IMMICH_BASE_URL", apiKey: "IMMICH_API_KEY" },
  dawarich: { baseUrl: "DAWARICH_BASE_URL", apiKey: "DAWARICH_API_KEY" },
  opensky: {
    clientId: "OPENSKY_CLIENT_ID",
    clientSecret: "OPENSKY_CLIENT_SECRET",
    username: "OPENSKY_USERNAME",
    password: "OPENSKY_PASSWORD",
  },
  ollama: { url: "OLLAMA_URL" },
};

type Row = Record<string, unknown> | null;

/** The plain value of a field; a secret is decrypted, an empty one is null. */
function plain(field: FieldDef | undefined, row: Row): string | null {
  if (!field) return null;
  const raw = row?.[field.column];
  if (typeof raw !== "string" || raw === "") return null;
  return field.kind === "secret" ? decryptApiKey(raw) : raw;
}

function creds(
  defs: readonly FieldDef[],
  row: Row,
  envFallback: boolean,
  service: ServiceDef
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of defs) out[f.key] = plain(f, row);
  // Fall back to the environment as the runtime does, field by field.
  if (envFallback) {
    for (const [key, name] of Object.entries(ENV_BY_FIELD[service.id] ?? {})) {
      if (!out[key]) out[key] = process.env[name] ?? null;
    }
    if (service.credential === "key" && !out.apiKey && service.env[0]) {
      out.apiKey = process.env[service.env[0]] ?? null;
    }
  }
  return out;
}

/** Stable cause codes for `lastTest.reason` (the page words them, never the server). */
export type TestReason =
  "auth" | "quota" | "timeout" | "network" | "http_error" | "not_found" | "disabled" | "unknown";

const REASON_BY_KEY: Record<string, TestReason> = {
  invalid: "auth",
  noKey: "auth",
  notConfigured: "not_found",
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
    reason: r.success ? null : toReasonCode(r.messageKey),
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
    case "immich":
    case "dawarich": {
      if (!c.baseUrl || !c.apiKey) return { ok: false, reason: "not_found" };
      const r =
        service.tester === "immich"
          ? await testImmichConnection(c.baseUrl, c.apiKey)
          : await testDawarichConnection(c.baseUrl, c.apiKey);
      return { ok: r.success, reason: r.success ? null : toReasonCode(r.kind) };
    }
    case "webdav": {
      const r = await testWebDAVConnection();
      return { ok: r.success, reason: r.success ? null : "network" };
    }
    case "ollama":
    case "llmCloud": {
      const target = llmTarget(service, c);
      if (!target) return { ok: false, reason: "not_found" };
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

/** Admin test of the instance credential. */
export async function testInstanceService(id: string): Promise<TestOutcome> {
  const service = getService(id);
  if (!service) throw new AppError("Unknown external service", 404, "SERVICE_NOT_FOUND");
  const state = await loadAdminState();
  const waitingForConsent = service.ai !== undefined && service.enabled.kind === "adminColumns";
  if (!isEnabled(service, state) && !waitingForConsent) throw disabled();
  if (state.policy.disabled.includes(id)) throw disabled();

  if (!service.tester) return { ok: false, reason: "unknown", usedQuota: false, lastTest: null };
  const outcome = await run(service, creds(service.fields, state.admin, true, service));
  const lastTest = await recordTest(null, id, outcome.ok, outcome.reason);
  return { ...outcome, usedQuota: METERED.has(service.tester), lastTest };
}

/** Account test of the account's OWN credential (never the instance's). */
export async function testAccountService(id: string, userId: string): Promise<TestOutcome> {
  const service = getService(id);
  if (!service || service.accountFields.length === 0) {
    throw new AppError("Unknown external service", 404, "SERVICE_NOT_FOUND");
  }
  if (await offReasonFor(id, userId)) throw disabled();
  const row = (await prisma.userSettings.findUnique({ where: { userId } })) as Row;
  if (!service.tester) return { ok: false, reason: "unknown", usedQuota: false, lastTest: null };
  const outcome = await run(service, creds(service.accountFields, row, false, service), userId);
  const lastTest = await recordTest(userId, id, outcome.ok, outcome.reason);
  return { ...outcome, usedQuota: METERED.has(service.tester), lastTest };
}
