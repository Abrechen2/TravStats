/**
 * Account-side writes (forgejo#392): the account's own key/connection, the
 * "switch it off for me" preference and the per-provider AI consent.
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { LlmProviderKind } from "../llm/llmEndpoint";
import { isEnabledForConsent } from "./accountView";
import { loadAdminState } from "./adminView";
import { AI_SERVICES, getService } from "./catalogue";
import { collectWrites } from "./fields";
import { loadPrefs, savePrefs, withMember } from "./policy";
import { testAccountService } from "./testRunner";
import logger from "../../utils/logger";

export interface AccountUpdateBody {
  fields?: Record<string, unknown>;
  accountDisabled?: boolean;
}

export async function applyAccountUpdate(
  userId: string,
  id: string,
  body: AccountUpdateBody
): Promise<void> {
  const service = getService(id);
  if (!service || service.level !== "instanceAndAccount") {
    throw new AppError("Unknown external service", 404, "SERVICE_NOT_FOUND");
  }
  const state = await loadAdminState();
  const fieldKeys = Object.keys(body.fields ?? {});

  if (service.connection && state.policy.connectionsForbidden.includes(id)) {
    throw new AppError(
      "The administrator does not allow this connection",
      403,
      "CONNECTION_NOT_ALLOWED"
    );
  }
  if (fieldKeys.length > 0) {
    if (!service.connection && state.policy.accountKeysForbidden.includes(id)) {
      throw new AppError(
        "The administrator does not allow your own key for this service",
        403,
        "ACCOUNT_KEYS_NOT_ALLOWED"
      );
    }
    if (state.policy.disabled.includes(id)) {
      throw new AppError(
        "This service is switched off by the administrator",
        409,
        "SERVICE_DISABLED"
      );
    }
    if (service.accountFields.length === 0) {
      // Strava (OAuth) and the account's WebDAV have their own connect flows.
      throw new AppError(
        "This connection is managed on its own page",
        400,
        "VALIDATION_FAILED",
        fieldKeys[0]
      );
    }
  }

  const writes = collectWrites(service, service.accountFields, body.fields ?? {});
  if (Object.keys(writes.user).length > 0) {
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, data: {}, ...writes.user },
      update: writes.user,
    });
  }
  if (body.accountDisabled !== undefined) {
    const prefs = await loadPrefs(userId);
    await savePrefs(userId, {
      ...prefs,
      disabled: withMember(prefs.disabled, id, body.accountDisabled),
    });
  }
  await refreshTestAfterSave(userId, id, body.fields ?? {}, service.tester !== undefined);
}

/**
 * There is no account test route: saving a credential tests it and persists
 * the verdict, so the page shows the result of what was just typed. Removing
 * the credential (every field "") drops the stale verdict instead. A failed
 * test never fails the save — the credential is stored either way.
 */
async function refreshTestAfterSave(
  userId: string,
  id: string,
  fields: Record<string, unknown>,
  testable: boolean
): Promise<void> {
  const values = Object.values(fields);
  if (values.length === 0) return;
  const cleared = values.every((v) => v === "" || v === null);
  if (cleared) {
    await prisma.externalServiceTest.deleteMany({ where: { userId, serviceId: id } });
    return;
  }
  if (!testable) return;
  try {
    await testAccountService(id, userId);
  } catch (error) {
    logger.warn(
      { serviceId: id, error: error instanceof Error ? error.message : "unknown" },
      "account service test after save failed"
    );
  }
}

/** Grant or withdraw the account's consent to send documents to one cloud AI provider. */
export async function setAiConsent(
  userId: string,
  provider: LlmProviderKind,
  consent: boolean
): Promise<{ provider: string; consentedAt: string | null }> {
  const prefs = await loadPrefs(userId);
  if (consent) {
    // Only a provider the admin allowed can be consented to — otherwise the
    // consent would be a promise about a destination nobody confirmed.
    const state = await loadAdminState();
    const service = AI_SERVICES.find((s) => s.ai?.kind === provider);
    if (!service || !isEnabledForConsent(service, state)) {
      throw new AppError(
        "This AI provider is not allowed on this instance",
        409,
        "SERVICE_DISABLED"
      );
    }
  }
  const { [provider]: _removed, ...rest } = prefs.aiConsent;
  void _removed;
  const consentedAt = consent ? new Date().toISOString() : null;
  await savePrefs(userId, {
    ...prefs,
    aiConsent: consentedAt ? { ...rest, [provider]: consentedAt } : rest,
  });
  return { provider, consentedAt };
}
