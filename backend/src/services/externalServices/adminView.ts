/**
 * The admin read model of the external services (forgejo#392,
 * `GET /admin/external-services`): one pass over the settings rows, no
 * per-service query. Secrets are masked; nothing here calls out.
 */
import { prisma } from "../../db";
import { AI_SERVICES, CONNECTION_IDS, SERVICES, getService } from "./catalogue";
import { hasValue, viewField, type FieldSource, type FieldView } from "./fields";
import { loadAllTests, type LastTest } from "./tests";
import { quotaFor, type QuotaView } from "./quota";
import { parsePolicy, parsePrefs } from "./policy";
import { currentConsentDestination } from "./consentBinding";
import { isLlmProviderKind, isLocalLlmHost } from "../llm/llmEndpoint";
import { CATEGORY_ORDER, type ExternalServicePolicy, type ServiceDef } from "./types";

export interface AdminServiceView {
  id: string;
  category: string;
  level: ServiceDef["level"];
  credential: ServiceDef["credential"];
  keyless: boolean;
  /** No off switch: core to the app (the page shows why). */
  alwaysOn: boolean;
  getKeyUrl: string | null;
  recommended: ServiceDef["recommended"];
  enabled: boolean;
  configured: boolean;
  instanceSource: "instance" | "env" | "none";
  allowAccountKeys: boolean | null;
  lastTest: LastTest | null;
  quota: QuotaView | null;
  fields: FieldView[];
  consent?: { allowedByAdmin: boolean; accountsConsented: number };
}

export interface AdminState {
  admin: Record<string, unknown> | null;
  smtp: Record<string, unknown> | null;
  policy: ExternalServicePolicy;
}

export async function loadAdminState(): Promise<AdminState> {
  const [admin, smtp] = await Promise.all([
    prisma.adminSettings.findFirst({ orderBy: { id: "asc" } }),
    prisma.smtpConfig.findUnique({ where: { id: 1 } }),
  ]);
  return {
    admin: admin as unknown as Record<string, unknown> | null,
    smtp: smtp as unknown as Record<string, unknown> | null,
    policy: parsePolicy(admin?.externalServicePolicy),
  };
}

/** The service's `enabled`, from the switch it is stored in. */
export function isEnabled(service: ServiceDef, state: AdminState): boolean {
  // An always-on service has no off switch; a stale policy entry cannot turn it off.
  if (service.alwaysOn) return true;
  const b = service.enabled;
  switch (b.kind) {
    case "policy":
      return !state.policy.disabled.includes(service.id);
    case "adminColumns":
      return b.columns.some((c) => state.admin?.[c] === true);
    case "smtp":
      return state.smtp?.enabled === true;
    case "push":
      return state.admin?.pushEnabled === true;
    case "federation":
      return state.admin?.federationEnabled === true;
    case "usageStats":
      return state.admin?.usageStatsConsent === "granted";
  }
}

/**
 * Does this AI service send a document off the network? Every hosted provider
 * does; Ollama only when its address is not a local one (a local Ollama keeps
 * the data at home and has nothing to consent to).
 */
export function isCloudAi(service: ServiceDef, state: AdminState): boolean {
  if (!service.ai) return false;
  if (service.ai.kind !== "ollama") return true;
  const raw = state.admin?.ollamaUrl ?? process.env.OLLAMA_URL;
  if (typeof raw !== "string" || raw === "") return false;
  try {
    return !isLocalLlmHost(new URL(raw).hostname);
  } catch {
    return false;
  }
}

/** Is a server environment variable standing in for the instance credential? */
export function envPresent(service: ServiceDef): boolean {
  if (service.env.length === 0) return false;
  const set = service.env.map((name) => !!process.env[name]);
  return service.credential === "urlKey" ? set.every(Boolean) : set.some(Boolean);
}

function sourceOf(service: ServiceDef, src: FieldSource): "instance" | "env" | "none" {
  const stored =
    service.requiredFields.length > 0 &&
    service.requiredFields.every((key) => {
      const field = service.fields.find((f) => f.key === key);
      return field ? hasValue(field, src) : false;
    });
  if (stored) return "instance";
  return envPresent(service) ? "env" : "none";
}

/** Accounts whose consent still matches the provider's current address. */
function consentCounts(
  rows: Array<{ externalServicePrefs: unknown }>,
  admin: AdminState["admin"]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const [kind, entry] of Object.entries(parsePrefs(row.externalServicePrefs).aiConsent)) {
      if (!isLlmProviderKind(kind)) continue;
      const bound = currentConsentDestination(admin, kind);
      if (bound === null || entry.destination !== bound) continue;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  return counts;
}

export async function buildAdminView(): Promise<{
  categories: Array<{ id: string; services: AdminServiceView[] }>;
  accountConnections: Array<{
    id: (typeof CONNECTION_IDS)[number];
    allowed: boolean;
    connectedAccounts: number;
  }>;
}> {
  const state = await loadAdminState();
  const src: FieldSource = { admin: state.admin, smtp: state.smtp };
  const [tests, prefRows, connected] = await Promise.all([
    loadAllTests(null),
    prisma.userSettings.findMany({
      where: { NOT: { externalServicePrefs: { equals: {} } } },
      select: { externalServicePrefs: true },
    }),
    countConnections(),
  ]);
  const consents = consentCounts(prefRows, state.admin);

  const services: AdminServiceView[] = [];
  for (const service of SERVICES) {
    if (service.adminRow === false) continue;
    const enabled = isEnabled(service, state);
    const source = sourceOf(service, src);
    const view: AdminServiceView = {
      id: service.id,
      category: service.category,
      level: service.level,
      credential: service.credential,
      keyless: service.keyless,
      alwaysOn: service.alwaysOn,
      getKeyUrl: service.getKeyUrl,
      recommended: service.recommended,
      enabled,
      configured: service.keyless && service.requiredFields.length === 0 ? true : source !== "none",
      instanceSource: source,
      allowAccountKeys:
        service.level === "instanceAndAccount" && !service.connection
          ? !state.policy.accountKeysForbidden.includes(service.id)
          : null,
      lastTest: tests.get(service.id) ?? null,
      quota: await quotaFor(service),
      fields: service.fields.map((f) => viewField(f, src)),
    };
    if (service.ai && isCloudAi(service, state)) {
      view.consent = {
        allowedByAdmin: enabled,
        accountsConsented: consents.get(service.ai.kind) ?? 0,
      };
    }
    services.push(view);
  }

  return {
    categories: CATEGORY_ORDER.map((id) => ({
      id,
      services: services.filter((s) => s.category === id),
    })),
    accountConnections: CONNECTION_IDS.map((id) => ({
      id,
      allowed: !state.policy.connectionsForbidden.includes(id),
      connectedAccounts: connected[id],
    })),
  };
}

async function countConnections(): Promise<Record<(typeof CONNECTION_IDS)[number], number>> {
  const [immich, dawarich, strava, webdav] = await Promise.all([
    prisma.userSettings.count({
      where: { immichBaseUrl: { not: null }, immichApiKey: { not: null } },
    }),
    prisma.userSettings.count({
      where: { dawarichBaseUrl: { not: null }, dawarichApiKey: { not: null } },
    }),
    prisma.userSettings.count({ where: { stravaAccessToken: { not: null } } }),
    prisma.userWebdavSync.count(),
  ]);
  return { immich, dawarich, strava, webdav };
}

export { AI_SERVICES, getService };
