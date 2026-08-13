/**
 * Helper functions for loading and decrypting parser settings
 */

import { prisma } from '../db';
import { decryptApiKey } from '../utils/encryption';

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
  defaultVisionParser?: string | null;
  defaultTextParser?: string | null;
  ollamaUrl?: string | null;
  ollamaModel?: string | null;
  ollamaVisionModel?: string | null;
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
  const settings = await prisma.adminSettings.findFirst();

  if (!settings) {
    return null;
  }

  // Decrypt API keys
  return {
    globalOpenaiApiKey: decryptApiKey(settings.globalOpenaiApiKey),
    globalClaudeApiKey: decryptApiKey(settings.globalClaudeApiKey),
    allowUserApiKeys: settings.allowUserApiKeys,
    defaultVisionParser: settings.defaultVisionParser,
    defaultTextParser: settings.defaultTextParser,
    ollamaUrl: settings.ollamaUrl,
    ollamaModel: settings.ollamaModel,
    ollamaVisionModel: settings.ollamaVisionModel,
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
export async function getParserConfigWithSettings(userId: string): Promise<ParserConfigWithSettings> {
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
    select: { fxCdnFallbackEnabled: true },
  });
  return { cdnFallbackEnabled: settings?.fxCdnFallbackEnabled ?? true };
}
