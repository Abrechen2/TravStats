/**
 * Whether a language model may be asked anything — ONE home for the answer.
 *
 * Owner decision 2026-09-25: an admin can turn the model off. Before that the
 * only way to keep a document away from Ollama was to leave the URL empty,
 * and even that did not hold: every Ollama caller fell back to `OLLAMA_URL`
 * from the environment, and the `USE_LLM_PARSER` variable that looked like a
 * switch was read by nothing (measured 2026-09-01). An operator who wanted
 * deterministic parses, or wanted no mail text leaving the box, had no say.
 *
 * Two layers, on purpose:
 *
 *  1. `llmRefusalFor(userId)` is what a PIPELINE asks before it even probes the
 *     model, so a refused parse takes the same "templates only" path an
 *     instance without a model takes, with a reason the UI can show. It also
 *     carries the shared-demo denial (security audit of 2026-09-19, finding 3),
 *     which used to be asked separately in three places.
 *  2. `assertLlmEnabled()` / `assertLlmCloudConsent()` sit directly in front
 *     of every generate request. A pipeline that forgot layer 1 fails closed
 *     here instead of quietly sending the document. `llmGate.entryPoints.test.ts`
 *     scans the source for model endpoints and fails for any file that talks
 *     to one without calling this — so a new caller cannot bypass the switch
 *     by simply not knowing about it.
 *
 * The switch covers the trip summary as well as parsing. There is no separate
 * summary toggle (its beta gate was removed on 2026-09-18), and the owner's
 * rule was "off = never a model call"; a summary is a model call.
 *
 * beta.18: `llmProvider.ts` resolves a FALLBACK CHAIN — Ollama first, then the
 * enabled+consented cloud slots in the admin's order — instead of one
 * admin-picked "active" provider. Consent is per slot
 * (`llm_openai_opt_in`/`llm_anthropic_opt_in`/`llm_google_opt_in`/
 * `llm_custom_opt_in`, plus `llm_ollama_opt_in` for the edge case of a remote
 * Ollama): granting OpenAI says nothing about Anthropic. That means
 * `providerRefusal` below can no longer ask "is THE configured provider
 * refused" — there is no longer a single one. It asks the chain's own
 * question instead: is ANYTHING in it usable? Two answers stay distinguished,
 * because they are different admin mistakes:
 *
 *  - `provider_incomplete` — nothing is even configured (no Ollama URL, no
 *    cloud slot has a key/endpoint) — there is nothing to consent to yet.
 *  - `cloud_not_consented` — something IS configured (a key was entered, an
 *    Ollama URL was set) but none of it has been allowed to run — the admin
 *    typed a key and stopped one step short.
 *
 * The reason text names no single company any more: several slots can be in
 * either state at once, and naming one would be a guess. The chain's own
 * per-slot mechanics — which cloud slots exist and their provider-named
 * consent copy — live in `llmProvider.ts` and the admin settings UI.
 */

import { AppError } from "../../middleware/errorHandler";
import { getAdminParserSettings, type AdminParserSettings } from "../parserSettings";
import { isSharedDemoUser } from "../../utils/sharedDemo";
import { checkLlmBaseUrl, isLocalLlmHost, type LlmProviderKind } from "./llmEndpoint";

/** Why a model was not asked. Distinct kinds, because the UI says different things. */
export type LlmRefusalKind =
  | "disabled_by_admin"
  | "shared_demo"
  /** Something is configured, but nothing in the chain has been consented to. */
  | "cloud_not_consented"
  /** Neither Ollama nor any cloud slot carries a usable key/endpoint yet. */
  | "provider_incomplete";

export interface LlmRefusal {
  kind: LlmRefusalKind;
  /** The sentence a parse response carries as `fallbackReason`. */
  reason: string;
}

export const LLM_DISABLED_REASON =
  "The AI parser is turned off by the administrator — only the built-in templates were tried.";

/**
 * What the shared demo account is told instead of an Ollama endpoint. It names
 * the account rather than the endpoint: an unreachable-Ollama reason quotes the
 * admin's URL, which is not the shared account's business.
 */
export const DEMO_NO_LLM_REASON =
  "The AI parser is not available for the shared demo account — only the built-in templates were tried.";

export const LLM_CLOUD_NOT_CONSENTED_REASON =
  "An AI provider is configured but the administrator has not allowed sending documents to it yet — only the built-in templates were tried.";

export const LLM_PROVIDER_INCOMPLETE_REASON =
  "No AI provider is fully configured (Ollama, or a cloud provider's key and model) — only the built-in templates were tried.";

/** Whether the admin-set Ollama URL/env fallback is on the local network at all. */
function ollamaConfiguredUrl(settings: AdminParserSettings | null): string | null {
  return settings?.ollamaUrl ?? process.env.OLLAMA_URL ?? null;
}

/** Ollama is eligible when it has an endpoint AND (local, or a remote one the admin allowed). */
function ollamaEligible(settings: AdminParserSettings | null): boolean {
  const url = ollamaConfiguredUrl(settings);
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return isLocalLlmHost(host) ? true : (settings?.llmOllamaOptIn ?? false);
}

/** The custom (OpenAI-compatible) slot's base URL/model, valid and non-empty. */
function customSlotConfigured(settings: AdminParserSettings | null): boolean {
  if (!settings?.openaiCompatBaseUrl || !settings?.openaiCompatModel) return false;
  return checkLlmBaseUrl(settings.openaiCompatBaseUrl).ok;
}

function customSlotEligible(settings: AdminParserSettings | null): boolean {
  if (!customSlotConfigured(settings)) return false;
  const check = checkLlmBaseUrl(settings!.openaiCompatBaseUrl!);
  if (!check.ok) return false;
  return check.isLocal || (settings?.llmCustomOptIn ?? false);
}

/** Any of the three fixed-endpoint cloud slots that carries a key. */
function anyFixedSlotConfigured(settings: AdminParserSettings | null): boolean {
  return (
    !!settings?.llmOpenaiApiKey || !!settings?.llmAnthropicApiKey || !!settings?.llmGoogleApiKey
  );
}

function anyFixedSlotEligible(settings: AdminParserSettings | null): boolean {
  if (settings?.llmOpenaiApiKey && (settings?.llmOpenaiOptIn ?? false)) return true;
  if (settings?.llmAnthropicApiKey && (settings?.llmAnthropicOptIn ?? false)) return true;
  if (settings?.llmGoogleApiKey && (settings?.llmGoogleOptIn ?? false)) return true;
  return false;
}

/**
 * Whether the admin has typed ANYTHING into any slot at all — an Ollama URL,
 * a custom base URL, or a cloud key. A truly blank instance (nothing typed
 * anywhere) is not a refusal: it falls through to the localhost Ollama
 * default downstream (`resolveLlmChain`'s `withDefaults` branch), exactly
 * the beta.17 and earlier behaviour of "assume Ollama at localhost until
 * told otherwise". The moment ANYTHING is typed, that assumption is gone —
 * an admin who typed a `custom` base URL but forgot the model wanted THAT
 * provider, not a silent fallback to a localhost Ollama they never asked
 * for, so the gate refuses instead of guessing.
 */
function anythingConfigured(settings: AdminParserSettings | null): boolean {
  return (
    !!ollamaConfiguredUrl(settings) ||
    !!settings?.openaiCompatBaseUrl ||
    !!settings?.llmOpenaiApiKey ||
    !!settings?.llmAnthropicApiKey ||
    !!settings?.llmGoogleApiKey
  );
}

/**
 * The provider half of the refusal, answered from the settings alone (no
 * network): is there anything in the fallback chain at all, and if there is,
 * has any of it been consented to?
 */
function providerRefusal(settings: AdminParserSettings | null): LlmRefusal | null {
  if (!anythingConfigured(settings)) return null;
  if (ollamaEligible(settings)) return null;
  if (customSlotEligible(settings) || anyFixedSlotEligible(settings)) return null;

  const configuredButUnconsented =
    !!ollamaConfiguredUrl(settings) ||
    customSlotConfigured(settings) ||
    anyFixedSlotConfigured(settings);
  return configuredButUnconsented
    ? { kind: "cloud_not_consented", reason: LLM_CLOUD_NOT_CONSENTED_REASON }
    : { kind: "provider_incomplete", reason: LLM_PROVIDER_INCOMPLETE_REASON };
}

/**
 * The admin switch. No settings row means a fresh instance, which gets the
 * column's own default — on — so an instance configured purely through the
 * environment keeps parsing with its model until an admin says otherwise.
 */
export async function isLlmEnabledByAdmin(): Promise<boolean> {
  const settings = await getAdminParserSettings();
  return settings?.llmEnabled ?? true;
}

/**
 * Whether THIS caller's document may go to the model, and if not, why.
 * The admin switch is asked first: it is the broader refusal, and the reason
 * it gives is the one that is true for everyone on the instance.
 */
export async function llmRefusalFor(userId?: string): Promise<LlmRefusal | null> {
  const settings = await getAdminParserSettings();
  if (!(settings?.llmEnabled ?? true)) {
    return { kind: "disabled_by_admin", reason: LLM_DISABLED_REASON };
  }
  const provider = providerRefusal(settings);
  if (provider) return provider;
  if (userId !== undefined && (await isSharedDemoUser(userId))) {
    return { kind: "shared_demo", reason: DEMO_NO_LLM_REASON };
  }
  return null;
}

/**
 * The last line in front of a model request. 503 with a stable code, so a
 * route that reaches it without asking `llmRefusalFor` first still answers
 * something a client can tell apart from "the model is down".
 */
export async function assertLlmEnabled(): Promise<void> {
  if (!(await isLlmEnabledByAdmin())) {
    throw new AppError(LLM_DISABLED_REASON, 503, "LLM_DISABLED");
  }
}

/** Which settings column carries THIS slot's own consent. */
function consentGranted(settings: AdminParserSettings | null, kind: LlmProviderKind): boolean {
  switch (kind) {
    case "openai":
      return settings?.llmOpenaiOptIn ?? false;
    case "anthropic":
      return settings?.llmAnthropicOptIn ?? false;
    case "google":
      return settings?.llmGoogleOptIn ?? false;
    case "ollama":
      return settings?.llmOllamaOptIn ?? false;
    case "custom":
      return settings?.llmCustomOptIn ?? false;
  }
}

/**
 * The consent half of the last line: a request bound for a host outside the
 * local network goes nowhere without THAT SLOT'S OWN admin opt-in — never a
 * different slot's. `isCloud`/`kind` are decided when the target is resolved
 * (`llmProvider.ts`), from the same `isLocalLlmHost` rule `providerRefusal`
 * reads. By construction only an already-eligible target ever reaches this
 * (the chain never carries an unconsented one), so this is the safety net —
 * a caller that resolved a target itself (an explicit override, a test) — not
 * the normal path.
 */
export async function assertLlmCloudConsent(target: {
  kind?: LlmProviderKind;
  isCloud?: boolean;
}): Promise<void> {
  if (!target.isCloud) return;
  const settings = await getAdminParserSettings();
  if (!consentGranted(settings, target.kind ?? "custom")) {
    throw new AppError(LLM_CLOUD_NOT_CONSENTED_REASON, 503, "LLM_CLOUD_NOT_CONSENTED");
  }
}
