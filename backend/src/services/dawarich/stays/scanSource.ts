/**
 * Where a stay scan reads its points (TravTrack plan E3): the account's own
 * Dawarich connection, as always, or TravTrack.
 *
 * - Scheduled: provider `dawarich` → Dawarich (the own connection is checked
 *   by the scan, exactly as before); provider `travtrack` while TravTrack is
 *   available to the account → TravTrack; anything else is refused with
 *   today's `DAWARICH_SCAN_UNAVAILABLE`.
 * - "Scan now": provider `travtrack` → TravTrack, or 403 `TRAVTRACK_DISABLED`
 *   while the instance's TravTrack is off — before anything is reserved.
 *   Every other provider keeps today's behaviour: the own Dawarich connection,
 *   whatever the provider, or 409 `DAWARICH_OWN_CONNECTION_REQUIRED`.
 */
import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { getLocationProvider } from "../../locationProvider/provider";
import { createDawarichClient, type DawarichClient } from "../dawarichClient";
import { ownDawarichConnectionFor } from "../dawarichResolver";
import type { StaySourceKind } from "./availability";

export type StaySourceChoice = { kind: StaySourceKind; rev: number };
export type StaySource =
  { kind: "dawarich"; client: DawarichClient; rev: number } | { kind: "travtrack"; rev: number };

export async function ownConnection(userId: string) {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { dawarichBaseUrl: true, dawarichApiKey: true },
  });
  const connection =
    settings &&
    (await ownDawarichConnectionFor(userId, settings.dawarichBaseUrl, settings.dawarichApiKey));
  if (!connection)
    throw new AppError("Own Dawarich connection required", 409, "DAWARICH_OWN_CONNECTION_REQUIRED");
  return connection;
}

/** Which source a scan of this account reads, without touching it. Throws when none may. */
export async function staySourceKind(
  userId: string,
  options: { scheduled: boolean }
): Promise<StaySourceChoice> {
  const provider = await getLocationProvider(userId);
  if (provider.kind === "travtrack") {
    if (provider.status === "ok") return { kind: "travtrack", rev: provider.rev };
    if (options.scheduled)
      throw new AppError("Scan disabled or already running", 409, "DAWARICH_SCAN_UNAVAILABLE");
    throw new AppError("TravTrack is switched off on this server", 403, "TRAVTRACK_DISABLED");
  }
  if (options.scheduled && provider.kind !== "dawarich")
    throw new AppError("Scan disabled or already running", 409, "DAWARICH_SCAN_UNAVAILABLE");
  return { kind: "dawarich", rev: provider.rev };
}

/** The source itself: for Dawarich the client (a test's, or one on the own connection). */
export async function staySource(
  userId: string,
  options: { scheduled: boolean; client?: DawarichClient }
): Promise<StaySource> {
  const choice = await staySourceKind(userId, options);
  if (choice.kind === "travtrack") return { kind: "travtrack", rev: choice.rev };
  const client = options.client ?? createDawarichClient(await ownConnection(userId));
  return { kind: "dawarich", client, rev: choice.rev };
}

/**
 * Where the account's stay scan would read, and whether it can (the settings
 * card). Provider `travtrack` reads TravTrack: connected while TravTrack is
 * available to the account. Every other provider reads the own Dawarich
 * connection, exactly as before.
 */
export async function staySourceStatus(
  userId: string
): Promise<{ source: StaySourceKind; connected: boolean }> {
  const provider = await getLocationProvider(userId);
  if (provider.kind === "travtrack")
    return { source: "travtrack", connected: provider.status === "ok" };
  try {
    await ownConnection(userId);
    return { source: "dawarich", connected: true };
  } catch (error) {
    // Only "no own connection" means disconnected; a database error is one.
    if (error instanceof AppError && error.code === "DAWARICH_OWN_CONNECTION_REQUIRED")
      return { source: "dawarich", connected: false };
    throw error;
  }
}

/**
 * Consent to the scan (or its map modules) needs a source that can be read
 * (owner decision 2026-10-25): provider `travtrack` while TravTrack is on —
 * no own Dawarich connection — or else 403 `TRAVTRACK_DISABLED`; every other
 * provider the own Dawarich connection, as before. Revoking is never checked.
 */
export async function requireConsentSource(userId: string): Promise<void> {
  const provider = await getLocationProvider(userId);
  if (provider.kind === "travtrack") {
    if (provider.status === "ok") return;
    throw new AppError("TravTrack is switched off on this server", 403, "TRAVTRACK_DISABLED");
  }
  await ownConnection(userId);
}
