/**
 * The account read model (forgejo#392, `GET /settings/external-services`):
 * what THIS account may connect or bring, where each request would be served
 * from, and which cloud AI providers it has consented to. Nothing here calls out.
 */
import { prisma } from "../../db";
import { isLocalLlmHost } from "../llm/llmEndpoint";
import { AI_SERVICES, CONNECTION_IDS, SERVICES, getService } from "./catalogue";
import { envPresent, isEnabled, loadAdminState, type AdminState } from "./adminView";
import { hasValue, viewField, type FieldSource, type FieldView } from "./fields";
import { parsePrefs } from "./policy";
import { currentConsentDestination } from "./consentBinding";
import { quotaFor, type QuotaView } from "./quota";
import { loadAllTests, type LastTest } from "./tests";
import type { Recommended, ServiceDef } from "./types";

export type EffectiveSource = "account" | "instance" | "env" | "none" | "off";

export interface AccountServiceView {
  id: string;
  recommended: Recommended;
  effectiveSource: EffectiveSource;
  accountDisabled: boolean;
  configured: boolean;
  lastTest: LastTest | null;
  quota: QuotaView | null;
  fields: FieldView[];
}

const FIXED_DESTINATION: Record<string, string> = {
  openai: "api.openai.com",
  anthropic: "api.anthropic.com",
  google: "generativelanguage.googleapis.com",
};

function hostOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function instanceHas(service: ServiceDef, src: FieldSource): boolean {
  return (
    service.requiredFields.length > 0 &&
    service.requiredFields.every((key) => {
      const f = service.fields.find((x) => x.key === key);
      return f ? hasValue(f, src) : false;
    })
  );
}

/** Where a request of this account would be served from, account → instance → env → none. */
export function effectiveSourceFor(
  service: ServiceDef,
  state: AdminState,
  prefs: ReturnType<typeof parsePrefs>,
  accountHas: boolean
): EffectiveSource {
  if (state.policy.disabled.includes(service.id) || prefs.disabled.includes(service.id)) {
    return "off";
  }
  const accountMayBring = service.connection
    ? !state.policy.connectionsForbidden.includes(service.id)
    : !state.policy.accountKeysForbidden.includes(service.id);
  if (accountHas && accountMayBring) return "account";
  if (instanceHas(service, { admin: state.admin, smtp: state.smtp })) return "instance";
  return envPresent(service) ? "env" : "none";
}

async function accountHasCredential(
  service: ServiceDef,
  userRow: Record<string, unknown> | null,
  userId: string
): Promise<boolean> {
  if (service.id === "strava") return !!userRow?.stravaAccessToken;
  if (service.id === "webdav") {
    const sync = await prisma.userWebdavSync.findUnique({
      where: { userId },
      select: { url: true, passwordEncrypted: true },
    });
    return !!sync?.url && !!sync.passwordEncrypted;
  }
  return (
    service.requiredFields.length > 0 &&
    service.requiredFields.every((key) => {
      const f = service.accountFields.find((x) => x.key === key);
      return f ? hasValue(f, { user: userRow }) : false;
    })
  );
}

export async function buildAccountView(userId: string): Promise<{
  connections: AccountServiceView[];
  ownKeys: AccountServiceView[];
  aiConsents: Array<{
    id: string;
    provider: string;
    destination: string;
    consentedAt: string | null;
  }>;
  instanceProvided: Array<{ id: string; enabled: boolean; recommended: Recommended }>;
}> {
  const state = await loadAdminState();
  const userRow = (await prisma.userSettings.findUnique({ where: { userId } })) as Record<
    string,
    unknown
  > | null;
  const prefs = parsePrefs(userRow?.externalServicePrefs);
  const tests = await loadAllTests(userId);

  const view = async (service: ServiceDef): Promise<AccountServiceView> => {
    const has = await accountHasCredential(service, userRow, userId);
    return {
      id: service.id,
      recommended: service.recommended,
      effectiveSource: effectiveSourceFor(service, state, prefs, has),
      accountDisabled: prefs.disabled.includes(service.id),
      configured: has,
      lastTest: tests.get(service.id) ?? null,
      quota: has ? await quotaFor(service, userId) : null,
      fields: service.accountFields.map((f) => viewField(f, { user: userRow })),
    };
  };

  const connections: AccountServiceView[] = [];
  for (const id of CONNECTION_IDS) {
    const service = getService(id);
    if (service && !state.policy.connectionsForbidden.includes(id)) {
      connections.push(await view(service));
    }
  }

  const ownKeys: AccountServiceView[] = [];
  for (const service of SERVICES) {
    const bringsKey =
      service.level === "instanceAndAccount" &&
      !service.connection &&
      !state.policy.accountKeysForbidden.includes(service.id) &&
      !state.policy.disabled.includes(service.id);
    if (bringsKey) ownKeys.push(await view(service));
  }

  const aiConsents = AI_SERVICES.flatMap((service) => {
    const kind = service.ai!.kind;
    if (!isEnabledForConsent(service, state)) return [];
    const destination =
      kind === "custom"
        ? hostOf(state.admin?.openaiCompatBaseUrl)
        : kind === "ollama"
          ? hostOf(state.admin?.ollamaUrl ?? process.env.OLLAMA_URL)
          : FIXED_DESTINATION[kind];
    // A local endpoint is not "cloud": nothing leaves the network, so nothing to consent to.
    if (!destination || ((kind === "custom" || kind === "ollama") && isLocalLlmHost(destination))) {
      return [];
    }
    // Consent counts only for the address it was given for (invariant 2).
    const stored = prefs.aiConsent[kind];
    const bound = currentConsentDestination(state.admin, kind);
    const consentedAt = stored && bound !== null && stored.destination === bound ? stored.at : null;
    return [{ id: service.id, provider: kind, destination, consentedAt }];
  });

  const instanceProvided = SERVICES.filter(
    (s) =>
      s.level === "instance" &&
      (s.category === "flight" || s.category === "mapsRoutes" || s.category === "openData") &&
      (s.keyless || instanceHas(s, { admin: state.admin, smtp: state.smtp }) || envPresent(s))
  ).map((s) => ({ id: s.id, enabled: isEnabled(s, state), recommended: s.recommended }));

  return { connections, ownKeys, aiConsents, instanceProvided };
}

/** A cloud provider the admin has allowed (opt-in) — or a remote Ollama with its opt-in. */
export function isEnabledForConsent(service: ServiceDef, state: AdminState): boolean {
  if (service.ai?.kind === "ollama") {
    return state.admin?.llmOllamaOptIn === true && !state.policy.disabled.includes("ollama");
  }
  return isEnabled(service, state) && instanceHas(service, { admin: state.admin });
}
