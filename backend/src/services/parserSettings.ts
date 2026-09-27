/**
 * Helper functions for loading and decrypting parser settings
 */

import { prisma } from "../db";
import { decryptApiKey } from "../utils/encryption";

export interface UserParserSettings {
  preferredVisionParser?: string | null;
  preferredTextParser?: string | null;
  visionFallbackChain?: string | null;
  textFallbackChain?: string | null;
  openaiApiKey?: string | null;
  claudeApiKey?: string | null;
}

export interface AdminParserSettings {
  globalOpenaiApiKey?: string | null;
  globalClaudeApiKey?: string | null;
  allowUserApiKeys?: boolean;
  ollamaUrl?: string | null;
  ollamaModel?: string | null;
  ollamaVisionModel?: string | null;
  parserOrder?: string | null;
  /** The admin switch — see `services/llm/llmGate.ts`, its only reader. */
  llmEnabled?: boolean;
  /**
   * Consent for a REMOTE Ollama (the common local case never needs one). Its
   * own flag rather than borrowed from any cloud slot — "ollama" is a fifth
   * protocol kind, not a company, but a public host is still somebody else's
   * computer.
   */
  llmOllamaOptIn?: boolean;

  /**
   * The `custom` slot (beta.17's `openai_compatible`): a free-form
   * OpenAI-compatible base URL — OpenRouter, Ollama Cloud, a LAN vLLM/LM
   * Studio. Field names kept from beta.17 on purpose: the beta.18 migration
   * maps existing rows onto this slot verbatim, without moving the URL/model/
   * key into new columns.
   */
  openaiCompatBaseUrl?: string | null;
  openaiCompatModel?: string | null;
  /** Decrypted. Never logged, never returned by an API (masked there). */
  openaiCompatApiKey?: string | null;
  /** The custom slot's OWN consent — replaces beta.17's single `llmCloudOptIn`. */
  llmCustomOptIn?: boolean;

  /** OpenAI — fixed endpoint (`services/llm/llmProvider.ts` `OPENAI_BASE_URL`), key + model only. */
  llmOpenaiApiKey?: string | null;
  llmOpenaiModel?: string | null;
  llmOpenaiOptIn?: boolean;

  /** Anthropic — native Messages API, fixed endpoint, key + model only. */
  llmAnthropicApiKey?: string | null;
  llmAnthropicModel?: string | null;
  llmAnthropicOptIn?: boolean;

  /** Google — Gemini's own OpenAI-compatible endpoint, fixed, key + model only. */
  llmGoogleApiKey?: string | null;
  llmGoogleModel?: string | null;
  llmGoogleOptIn?: boolean;

  /**
   * The admin's priority among the four cloud slots, comma-separated
   * (`services/llm/llmProvider.ts` `parseProviderOrder`). Ollama is not in
   * this list — it is implicitly always tried first when eligible.
   */
  llmProviderOrder?: string | null;
}

/**
 * Which reader gets the first look at a booking document.
 *
 * ONE home for the rule, read by all four domains (see
 * `shared/` conventions): flight mails used to be LLM-first whenever an
 * Ollama was configured, while lodging and cruise were template-first — three
 * hardcoded orders and no way for an admin to say otherwise.
 *
 * The default is `template_first`, measured on 2026-09-17 against the sample
 * corpus: the template chain read 31 of 31 flight mails and met all 29
 * expectations in under a second, where gemma3:12b took 19 minutes and missed
 * three. `llm_first` is there because a corpus is not every mail: an instance
 * whose senders are all unknown to the templates is better served by the model.
 */
export type ParserOrder = "template_first" | "llm_first";

export async function getParserOrder(): Promise<ParserOrder> {
  const settings = await getAdminParserSettings();
  return settings?.parserOrder === "llm_first" ? "llm_first" : "template_first";
}

/**
 * Load user parser settings with decrypted API keys
 */
export async function getUserParserSettings(userId: string): Promise<UserParserSettings | null> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: {
      preferredVisionParser: true,
      preferredTextParser: true,
      visionFallbackChain: true,
      textFallbackChain: true,
      openaiApiKey: true,
      claudeApiKey: true,
    },
  });

  if (!settings) {
    return null;
  }

  // Decrypt API keys
  return {
    ...settings,
    openaiApiKey: decryptApiKey(settings.openaiApiKey),
    claudeApiKey: decryptApiKey(settings.claudeApiKey),
  };
}

/**
 * Load admin parser settings with decrypted API keys
 */
export async function getAdminParserSettings(): Promise<AdminParserSettings | null> {
  const settings = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });

  if (!settings) {
    return null;
  }

  // Decrypt API keys
  return {
    globalOpenaiApiKey: decryptApiKey(settings.globalOpenaiApiKey),
    globalClaudeApiKey: decryptApiKey(settings.globalClaudeApiKey),
    allowUserApiKeys: settings.allowUserApiKeys,
    ollamaUrl: settings.ollamaUrl,
    ollamaModel: settings.ollamaModel,
    ollamaVisionModel: settings.ollamaVisionModel,
    parserOrder: settings.parserOrder,
    llmEnabled: settings.llmEnabled,
    llmOllamaOptIn: settings.llmOllamaOptIn,
    openaiCompatBaseUrl: settings.openaiCompatBaseUrl,
    openaiCompatModel: settings.openaiCompatModel,
    openaiCompatApiKey: decryptApiKey(settings.openaiCompatApiKey),
    llmCustomOptIn: settings.llmCustomOptIn,
    llmOpenaiApiKey: decryptApiKey(settings.llmOpenaiApiKey),
    llmOpenaiModel: settings.llmOpenaiModel,
    llmOpenaiOptIn: settings.llmOpenaiOptIn,
    llmAnthropicApiKey: decryptApiKey(settings.llmAnthropicApiKey),
    llmAnthropicModel: settings.llmAnthropicModel,
    llmAnthropicOptIn: settings.llmAnthropicOptIn,
    llmGoogleApiKey: decryptApiKey(settings.llmGoogleApiKey),
    llmGoogleModel: settings.llmGoogleModel,
    llmGoogleOptIn: settings.llmGoogleOptIn,
    llmProviderOrder: settings.llmProviderOrder,
  };
}

export interface ParserConfigWithSettings {
  userSettings: UserParserSettings | undefined;
  adminSettings: AdminParserSettings | undefined;
}

/**
 * Get parser config with user and admin settings merged
 * User settings take precedence over admin settings
 * Returns config ready to pass to getParserConfig
 */
export async function getParserConfigWithSettings(
  userId: string
): Promise<ParserConfigWithSettings> {
  const userSettings = await getUserParserSettings(userId);
  const adminSettings = await getAdminParserSettings();

  // Return both userSettings and adminSettings for getParserConfig
  return {
    userSettings: userSettings || undefined,
    adminSettings: adminSettings || undefined,
  };
}

export interface AdminFxSettings {
  cdnFallbackEnabled: boolean;
}

/**
 * The instance-level FX switch. Lives here rather than in the FX service so
 * `admin_settings` keeps ONE reader.
 *
 * No settings row at all means a fresh instance that has never opened the
 * admin page — it gets the column's own default (on), so a first-boot user
 * can convert an EGP booking without configuring anything.
 */
export async function getAdminFxSettings(): Promise<AdminFxSettings> {
  const settings = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { fxCdnFallbackEnabled: true },
  });
  return { cdnFallbackEnabled: settings?.fxCdnFallbackEnabled ?? true };
}
