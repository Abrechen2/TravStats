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
import { buildUserDawarichConnection } from "../dawarichResolver";
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
    settings && buildUserDawarichConnection(settings.dawarichBaseUrl, settings.dawarichApiKey);
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
