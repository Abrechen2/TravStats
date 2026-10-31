/**
 * `PUT /admin/external-services/:id` — a façade over the stores the old
 * per-service pages already write (forgejo#392). It adds no table of its own
 * for a service's data: a field lands in the same column, encrypted and
 * validated the same way, so either page reads what the other saved. The
 * policy (off / account keys / connections) is the only new state.
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { smtpConfigSchema, SMTP_CONFIG_ID } from "../../routes/admin/smtp";
import { applyConsentChange } from "../../routes/admin/usageStats";
import { federationSettingsSchema } from "../../schemas/federationAdmin";
import { ensureAdminSettingsRow } from "../adminSettingsRow";
import { resetIdentityCache } from "../federation/identity";
import { refreshInstanceTuning } from "../instanceTuning";
import { clearAvailabilityCache } from "../parsers/config";
import { clearLlmAvailabilityCache } from "../parsers/llmAvailability";
import { CONNECTION_IDS, getService } from "./catalogue";
import { collectWrites } from "./fields";
import { updatePolicy, withMember } from "./policy";
import type { ExternalServicePolicy, ServiceDef } from "./types";

export interface AdminUpdateBody {
  enabled?: boolean;
  allowAccountKeys?: boolean;
  fields?: Record<string, unknown>;
  confirmDataSharing?: boolean;
}

const CLEARED_PUSH_CREDENTIALS = { pushInstanceId: null, pushInstanceSecret: null } as const;

const consentRequired = (): AppError =>
  new AppError(
    "Sending documents to this provider needs an explicit confirmation",
    400,
    "CONSENT_REQUIRED"
  );

/** A cloud AI provider (remote Ollama and the custom endpoint included) being switched on. */
function turnsOnCloudAi(service: ServiceDef, body: AdminUpdateBody): boolean {
  if (!service.ai) return false;
  if (service.ai.kind === "ollama") return body.fields?.remoteOptIn === true;
  return body.enabled === true;
}

export async function applyAdminUpdate(id: string, body: AdminUpdateBody): Promise<void> {
  const service = getService(id);
  if (!service) throw new AppError("Unknown external service", 404, "SERVICE_NOT_FOUND");

  if (turnsOnCloudAi(service, body) && body.confirmDataSharing !== true) throw consentRequired();

  const writes = collectWrites(service, service.fields, body.fields ?? {});
  const adminData: Record<string, unknown> = { ...writes.admin };
  const smtpPatch: Record<string, unknown> = { ...writes.smtp };
  const policyEdits: Array<(p: ExternalServicePolicy) => ExternalServicePolicy> = [];
  const current = (await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } })) as Record<
    string,
    unknown
  > | null;

  if (body.allowAccountKeys !== undefined) {
    if (service.level !== "instanceAndAccount" || service.connection) {
      throw new AppError("This service has no account keys", 400, "VALIDATION_FAILED");
    }
    const allow = body.allowAccountKeys;
    policyEdits.push((p) => ({
      ...p,
      accountKeysForbidden: withMember(p.accountKeysForbidden, id, !allow),
    }));
  }

  if (body.enabled === false && service.alwaysOn) {
    throw new AppError(
      "This service cannot be switched off: the app depends on it",
      400,
      "VALIDATION_FAILED",
      "enabled"
    );
  }

  if (body.enabled !== undefined) {
    switch (service.enabled.kind) {
      case "policy":
        {
          const on = body.enabled;
          policyEdits.push((p) => ({ ...p, disabled: withMember(p.disabled, id, !on) }));
        }
        break;
      case "adminColumns":
        for (const column of service.enabled.columns) adminData[column] = body.enabled;
        break;
      case "smtp":
        smtpPatch.enabled = body.enabled;
        break;
      case "push":
        applyPushEnabled(body.enabled, current, adminData);
        break;
      case "federation":
        adminData.federationEnabled = body.enabled;
        break;
      case "usageStats":
        // Its own consent flow (erasure on withdrawal) — the same function the old page calls.
        await applyConsentChange(body.enabled ? "granted" : "denied");
        break;
    }
  }

  if (service.id === "push" && typeof adminData.pushRelayUrl === "string") {
    // Credentials belong to the relay that issued them.
    if (adminData.pushRelayUrl === current?.pushRelayUrl) delete adminData.pushRelayUrl;
    else Object.assign(adminData, CLEARED_PUSH_CREDENTIALS);
  }
  if (service.id === "federation" && (adminData.federationOrigin !== undefined || body.enabled)) {
    federationSettingsSchema.parse({
      enabled: adminData.federationEnabled ?? current?.federationEnabled ?? false,
      origin: adminData.federationOrigin ?? current?.federationOrigin ?? "",
    });
  }
  if (service.id === "webdav" && typeof adminData.webdavUrl === "string") {
    if (!/^https?:\/\//.test(adminData.webdavUrl)) {
      throw new AppError("Must be a valid http(s) URL", 400, "VALIDATION_FAILED", "url");
    }
  }

  if (Object.keys(smtpPatch).length > 0) await applySmtp(smtpPatch);
  if (policyEdits.length > 0) await updatePolicy((p) => policyEdits.reduce((acc, e) => e(acc), p));
  if (Object.keys(adminData).length > 0) {
    const id = await ensureAdminSettingsRow();
    await prisma.$transaction([
      prisma.adminSettings.update({ where: { id }, data: adminData }),
      ...consentWithdrawalsForAddressChange(adminData, current),
    ]);
  }
  if (service.id === "federation") resetIdentityCache();
  await refreshInstanceTuning();
  if (service.ai) {
    // A provider switch must be felt by the very next parse, not after the cache expires.
    clearAvailabilityCache();
    clearLlmAvailabilityCache();
  }
}

function applyPushEnabled(
  enabled: boolean,
  current: Record<string, unknown> | null,
  data: Record<string, unknown>
): void {
  if (enabled && current?.pushEnabled !== true) {
    data.pushEnabled = true;
    data.pushConsentAt = new Date();
  } else if (!enabled) {
    // Withdrawal: no consent on record, nothing registered at the relay.
    Object.assign(data, {
      pushEnabled: false,
      pushConsentAt: null,
      pushPausedUntil: null,
      ...CLEARED_PUSH_CREDENTIALS,
    });
  }
}

/** Merge a partial SMTP patch into the stored row and validate the whole. */
async function applySmtp(patch: Record<string, unknown>): Promise<void> {
  const stored = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
  // The password column holds ciphertext; the schema wants plain text, so it is
  // checked for presence only (a stand-in) and the ciphertext is stored as given.
  const { password, ...rest } = patch;
  const nextPassword =
    password === undefined ? (stored?.password ?? "") : ((password as string | null) ?? "");
  const parsed = smtpConfigSchema.safeParse({
    host: stored?.host,
    port: stored?.port,
    secure: stored?.secure,
    username: stored?.username,
    fromEmail: stored?.fromEmail,
    fromName: stored?.fromName,
    enabled: stored?.enabled,
    ...rest,
    password: nextPassword ? "stored" : "",
  });
  if (!parsed.success) {
    throw new AppError(
      "SMTP needs host, user, password and a sender address before it can be saved",
      400,
      "VALIDATION_FAILED"
    );
  }
  const data = { ...parsed.data, password: nextPassword };
  await prisma.smtpConfig.upsert({
    where: { id: SMTP_CONFIG_ID },
    create: { id: SMTP_CONFIG_ID, ...data },
    update: data,
  });
}

/** The ids an admin may forbid accounts to connect. */
export async function applyConnectionAllowed(id: string, allowed: boolean): Promise<void> {
  if (!(CONNECTION_IDS as readonly string[]).includes(id)) {
    throw new AppError("Unknown account connection", 404, "SERVICE_NOT_FOUND");
  }
  await updatePolicy((policy) => ({
    ...policy,
    connectionsForbidden: withMember(policy.connectionsForbidden, id, !allowed),
  }));
}

/**
 * An account's consent names a provider, and for a remote Ollama or the custom
 * endpoint the provider is whatever address the admin typed. A new address is a
 * new destination, so every account's consent for it is withdrawn and asked
 * again — documents never follow an address change silently.
 *
 * Returns the consent withdrawals as queries to run IN THE SAME TRANSACTION as
 * the address write, after it: a consent granted in between would otherwise
 * survive for the new address. Every write path of those two addresses
 * (this façade and the legacy parser-settings route) uses it.
 */
export function consentWithdrawalsForAddressChange(
  data: Record<string, unknown>,
  current: Record<string, unknown> | null
): Array<ReturnType<typeof prisma.$executeRaw>> {
  const withdrawals: Array<ReturnType<typeof prisma.$executeRaw>> = [];
  for (const [kind, column] of [
    ["custom", "openaiCompatBaseUrl"],
    ["ollama", "ollamaUrl"],
  ] as const) {
    if (data[column] === undefined || data[column] === (current?.[column] ?? null)) continue;
    withdrawals.push(
      prisma.$executeRaw`UPDATE user_settings SET external_service_prefs = external_service_prefs #- ARRAY['aiConsent', ${kind}]::text[] WHERE external_service_prefs -> 'aiConsent' ? ${kind}`
    );
  }
  return withdrawals;
}
