import crypto from "crypto";

import { prisma } from "../../db";
import { decryptApiKey, encryptApiKey } from "../../utils/encryption";
import { JWT_SECRET } from "../../utils/jwtSecret";
import { isSharedDemoUser } from "../../utils/sharedDemo";
import { refreshTokens, type StravaTokens } from "./stravaClient";
import { StravaError } from "./stravaErrors";

/**
 * Who may talk to Strava, and with which token.
 *
 * The CLIENT (the operator's registered Strava application) comes from the
 * admin settings, then the environment; TravStats ships none. The TOKEN is
 * the user's own, from their OAuth consent, refreshed here when it has run
 * out — Strava access tokens live six hours.
 */

export interface StravaClientConfig {
  id: string;
  secret: string;
}

export async function getStravaClient(): Promise<StravaClientConfig | null> {
  const admin = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { stravaClientId: true, stravaClientSecret: true },
  });
  const secret = admin?.stravaClientSecret ? decryptApiKey(admin.stravaClientSecret) : null;
  if (admin?.stravaClientId && secret) return { id: admin.stravaClientId, secret };
  const envId = process.env.STRAVA_CLIENT_ID;
  const envSecret = process.env.STRAVA_CLIENT_SECRET;
  return envId && envSecret ? { id: envId, secret: envSecret } : null;
}

export async function requireStravaClient(): Promise<StravaClientConfig> {
  const client = await getStravaClient();
  if (!client) throw new StravaError("notConfigured", "No Strava application is configured");
  return client;
}

// ---- OAuth state -----------------------------------------------------------
//
// The consent round trip leaves the site and comes back. The `state` binds
// the returning `code` to the user who started it and expires after ten
// minutes, so a code cannot be replayed into someone else's session. Signed
// with the instance's JWT secret; nothing is stored.

const STATE_TTL_MS = 10 * 60 * 1000;

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`strava-oauth:${payload}`)
    .digest("base64url");
}

export function createOAuthState(userId: string, now = Date.now()): string {
  const payload = `${userId}.${now + STATE_TTL_MS}.${crypto.randomBytes(8).toString("hex")}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function verifyOAuthState(state: string, userId: string, now = Date.now()): boolean {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) return false;
  const payload = Buffer.from(encoded, "base64url").toString();
  const expected = sign(payload);
  if (
    expected.length !== signature.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return false;
  }
  const [owner, expiresAt] = payload.split(".");
  return owner === userId && Number(expiresAt) > now;
}

// ---- Tokens ----------------------------------------------------------------

export async function saveStravaTokens(userId: string, tokens: StravaTokens): Promise<void> {
  const data = {
    stravaAccessToken: encryptApiKey(tokens.accessToken),
    stravaRefreshToken: encryptApiKey(tokens.refreshToken),
    stravaTokenExpiresAt: new Date(tokens.expiresAt * 1000),
    ...(tokens.athleteId ? { stravaAthleteId: tokens.athleteId } : {}),
    ...(tokens.scope ? { stravaScope: tokens.scope } : {}),
  };
  await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, data: {}, ...data },
    update: data,
  });
}

export async function clearStravaTokens(userId: string): Promise<void> {
  await prisma.userSettings.updateMany({
    where: { userId },
    data: {
      stravaAccessToken: null,
      stravaRefreshToken: null,
      stravaTokenExpiresAt: null,
      stravaAthleteId: null,
      stravaScope: null,
    },
  });
}

export interface StravaStatus {
  configured: boolean;
  connected: boolean;
  athleteId: string | null;
}

export async function getStravaStatus(userId: string): Promise<StravaStatus> {
  const [client, settings] = await Promise.all([
    getStravaClient(),
    prisma.userSettings.findUnique({
      where: { userId },
      select: { stravaRefreshToken: true, stravaAthleteId: true },
    }),
  ]);
  return {
    configured: client !== null,
    connected: Boolean(settings?.stravaRefreshToken),
    athleteId: settings?.stravaAthleteId ?? null,
  };
}

/** Refresh a minute early, so a token never expires mid-request. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * A usable access token for this user, refreshed if it has run out. The
 * shared demo account never reaches Strava — it is one login for many people.
 */
export async function getStravaAccessToken(userId: string): Promise<string> {
  if (await isSharedDemoUser(userId)) {
    throw new StravaError("notConfigured", "Strava is not available on the demo account");
  }
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { stravaAccessToken: true, stravaRefreshToken: true, stravaTokenExpiresAt: true },
  });
  const refresh = decryptApiKey(settings?.stravaRefreshToken ?? null);
  if (!refresh) throw new StravaError("notConfigured", "Strava is not connected");

  const access = decryptApiKey(settings?.stravaAccessToken ?? null);
  const expires = settings?.stravaTokenExpiresAt?.getTime() ?? 0;
  if (access && expires - REFRESH_MARGIN_MS > Date.now()) return access;

  const fresh = await refreshTokens(await requireStravaClient(), refresh);
  await saveStravaTokens(userId, fresh);
  return fresh.accessToken;
}
