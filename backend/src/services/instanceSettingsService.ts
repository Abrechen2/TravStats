/**
 * Instance settings service — reads configuration from AdminSettings (DB)
 * with a transitional ENV fallback.
 *
 * The DB row is authoritative once an admin has set it via the UI. ENV is
 * only consulted when the column is unset, so migrating from the v0.x
 * "all config via env" deployments works without an explicit import step.
 */

import type { Request } from "express";

import { prisma } from "../db";
import { encryptApiKey, decryptApiKey } from "../utils/encryption";
import logger from "../utils/logger";

export interface InstanceSettings {
  instanceName: string;
  maxUsers: number;
  allowRegistration: boolean;
  frontendUrl: string | null;
  publicUrl: string | null;
  lanUrl: string | null;
  /**
   * Instance-level beta gate — ON on RC/Beta servers, OFF on production.
   * Reveals features that are unfinished or not yet useful (registry:
   * `frontend/src/config/betaFeatures.ts`). Admin-settable only, via
   * PUT /api/v1/admin/instance-settings.
   *
   * NOTE: this is a *visibility* flag, not an authorisation boundary. The
   * endpoints behind the gated features (trip AI summary, /pairing/*) stay
   * reachable for any authenticated user regardless of its value — that is
   * deliberate, so the owner can still pair a phone while the UI is hidden.
   */
  betaFeaturesEnabled: boolean;
}

export interface WebDAVSettings {
  enabled: boolean;
  url: string | null;
  username: string | null;
  password: string | null;
  backupPath: string;
}

/** Single row — ensure it exists and return it. */
async function ensureAdminSettings() {
  const existing = await prisma.adminSettings.findFirst();
  if (existing) return existing;
  return prisma.adminSettings.create({ data: {} });
}

/**
 * Instance-level settings (name, user caps, registration, invite URL).
 * Reads the DB row; falls back to ENV for any field that is still unset.
 */
export async function getInstanceSettings(): Promise<InstanceSettings> {
  const row = await ensureAdminSettings();

  return {
    instanceName: row.instanceName ?? process.env.INSTANCE_NAME ?? "TravStats",
    maxUsers: row.maxUsers ?? parseInt(process.env.MAX_USERS ?? "10", 10),
    allowRegistration:
      row.allowRegistration ?? process.env.ALLOW_REGISTRATION === "true",
    frontendUrl:
      row.frontendUrl ??
      process.env.FRONTEND_URL ??
      process.env.CORS_ORIGIN?.split(",")[0]?.trim() ??
      null,
    publicUrl: row.publicUrl ?? process.env.PUBLIC_URL ?? null,
    lanUrl: row.lanUrl ?? process.env.LAN_URL ?? null,
    // Non-nullable column (default false) — no ENV fallback on purpose: an
    // instance is either flagged beta by an admin or it is not.
    betaFeaturesEnabled: row.betaFeaturesEnabled,
  };
}

export async function updateInstanceSettings(
  patch: Partial<InstanceSettings>,
): Promise<InstanceSettings> {
  const row = await ensureAdminSettings();
  await prisma.adminSettings.update({
    where: { id: row.id },
    data: {
      ...(patch.instanceName !== undefined && { instanceName: patch.instanceName || null }),
      ...(patch.maxUsers !== undefined && { maxUsers: patch.maxUsers }),
      ...(patch.allowRegistration !== undefined && {
        allowRegistration: patch.allowRegistration,
      }),
      ...(patch.frontendUrl !== undefined && {
        frontendUrl: patch.frontendUrl || null,
      }),
      ...(patch.publicUrl !== undefined && {
        publicUrl: patch.publicUrl || null,
      }),
      ...(patch.lanUrl !== undefined && {
        lanUrl: patch.lanUrl || null,
      }),
      ...(patch.betaFeaturesEnabled !== undefined && {
        betaFeaturesEnabled: patch.betaFeaturesEnabled,
      }),
    },
  });
  logger.info({ operation: "instance_settings_updated", fields: Object.keys(patch) });
  return getInstanceSettings();
}

/**
 * Resolve the base URL the mobile app (or any external client) should use to
 * reach this instance. Prefers the admin-configured `publicUrl`; falls back to
 * the origin derived from the incoming request (protocol + host) so a fresh
 * deployment that hasn't set the field still hands out a usable address.
 *
 * The returned value never carries a trailing slash.
 */
export async function getPublicBaseUrl(req: Request): Promise<string> {
  const { publicUrl } = await getInstanceSettings();
  if (publicUrl) return publicUrl.replace(/\/+$/, "");

  // `req.protocol` already honours `trust proxy` (set in index.ts) so it
  // reflects the X-Forwarded-Proto from nginx rather than the internal http.
  const host = req.get("host") ?? `localhost:${process.env.PORT ?? "8000"}`;
  return `${req.protocol}://${host}`.replace(/\/+$/, "");
}

/**
 * WebDAV sync settings. Password is AES-GCM encrypted at rest and decrypted
 * only when the caller actually needs it (connection tests, uploads).
 */
export async function getWebDAVSettings(): Promise<WebDAVSettings> {
  const row = await ensureAdminSettings();

  const dbPasswordEncrypted = row.webdavPasswordEncrypted;
  const dbPassword = dbPasswordEncrypted ? decryptApiKey(dbPasswordEncrypted) : null;

  const envPassword = process.env.WEBDAV_PASSWORD || null;

  return {
    enabled:
      row.webdavSyncEnabled ?? process.env.WEBDAV_SYNC_ENABLED === "true",
    url: row.webdavUrl ?? process.env.WEBDAV_URL ?? null,
    username: row.webdavUsername ?? process.env.WEBDAV_USERNAME ?? null,
    password: dbPassword ?? envPassword,
    backupPath:
      row.webdavBackupPath ||
      process.env.WEBDAV_BACKUP_PATH ||
      "/TravStats/backups/",
  };
}

export async function updateWebDAVSettings(
  patch: Partial<Omit<WebDAVSettings, "password">> & { password?: string | null },
): Promise<WebDAVSettings> {
  const row = await ensureAdminSettings();

  const nextPasswordEncrypted =
    patch.password === undefined
      ? undefined
      : patch.password === null || patch.password === ""
        ? null
        : encryptApiKey(patch.password);

  await prisma.adminSettings.update({
    where: { id: row.id },
    data: {
      ...(patch.enabled !== undefined && { webdavSyncEnabled: patch.enabled }),
      ...(patch.url !== undefined && { webdavUrl: patch.url || null }),
      ...(patch.username !== undefined && { webdavUsername: patch.username || null }),
      ...(nextPasswordEncrypted !== undefined && {
        webdavPasswordEncrypted: nextPasswordEncrypted,
      }),
      ...(patch.backupPath !== undefined && {
        webdavBackupPath: patch.backupPath || "/TravStats/backups/",
      }),
    },
  });
  logger.info({ operation: "webdav_settings_updated", fields: Object.keys(patch) });
  return getWebDAVSettings();
}
