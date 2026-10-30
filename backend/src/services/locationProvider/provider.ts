/**
 * The per-user location provider (TravTrack plan 2026-10-24, task S2): where
 * the Companion's NEW recordings go and where TravStats' automatic features
 * read positions from — `none`, `travtrack` or `dawarich`.
 *
 * A switch is a setting and nothing else (owner rule 2): no track moves, is
 * copied or is deleted, and the Dawarich connection stays as it was. Every
 * track keeps its origin.
 *
 * Dawarich counts only with the user's OWN connection, never the admin-global
 * or ENV one. The automatic features this provider drives run unattended and
 * write presence into an account; through a shared connection they would
 * attribute the operator's movements to every account on the instance — the
 * privacy boundary `buildUserDawarichConnection` documents.
 *
 * A provider that stopped working reports itself (`notConfigured`,
 * `unavailable`) and stays chosen: a removed key must not quietly turn a
 * Dawarich user into a `none` user whose phone starts recording.
 */
import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { ownDawarichConnectionFor } from "../dawarich/dawarichResolver";
import { travTrackAvailable } from "../travtrack/availability";

import { LOCATION_PROVIDER_KINDS, type LocationProviderKind, type ProviderStatus } from "./kinds";

export { LOCATION_PROVIDER_KINDS, type LocationProviderKind, type ProviderStatus };

export interface LocationProviderState {
  kind: LocationProviderKind;
  rev: number;
  status: ProviderStatus;
}

export interface LocationProviderChoices {
  none: true;
  travtrack: boolean;
  dawarich: boolean;
}

/**
 * Whether this instance offers TravTrack to this account (instance beta +
 * config, not the shared demo). Per-user activation IS choosing provider
 * `travtrack`; there is no second switch. Lives in `services/travtrack`;
 * re-exported here because the provider's callers ask it beside the provider.
 */
export { travTrackAvailable };

const isKind = (raw: string): raw is LocationProviderKind =>
  (LOCATION_PROVIDER_KINDS as readonly string[]).includes(raw);

const SELECT = {
  locationProvider: true,
  locationProviderRev: true,
  dawarichBaseUrl: true,
  dawarichApiKey: true,
} as const;

type ProviderRow = {
  locationProvider: string;
  locationProviderRev: number;
  dawarichBaseUrl: string | null;
  dawarichApiKey: string | null;
};

const readRow = (userId: string): Promise<ProviderRow | null> =>
  prisma.userSettings.findUnique({ where: { userId }, select: SELECT });

const hasOwnDawarich = async (userId: string, row: ProviderRow | null): Promise<boolean> =>
  (await ownDawarichConnectionFor(userId, row?.dawarichBaseUrl, row?.dawarichApiKey)) !== null;

async function statusOf(
  userId: string,
  kind: LocationProviderKind,
  row: ProviderRow | null
): Promise<ProviderStatus> {
  if (kind === "dawarich") return (await hasOwnDawarich(userId, row)) ? "ok" : "notConfigured";
  if (kind === "travtrack") return (await travTrackAvailable(userId)) ? "ok" : "unavailable";
  return "ok";
}

export async function getLocationProvider(userId: string): Promise<LocationProviderState> {
  const row = await readRow(userId);
  if (!row) return { kind: "none", rev: 0, status: "ok" };
  // The CHECK constraint holds the three values; anything else is read as the
  // provider that records and reads nothing elsewhere.
  const kind = isKind(row.locationProvider) ? row.locationProvider : "none";
  return { kind, rev: row.locationProviderRev, status: await statusOf(userId, kind, row) };
}

/** What this account may choose right now. `none` always. */
export async function getLocationProviderChoices(userId: string): Promise<LocationProviderChoices> {
  const [row, travtrack] = await Promise.all([readRow(userId), travTrackAvailable(userId)]);
  return { none: true, travtrack, dawarich: await hasOwnDawarich(userId, row) };
}

/** `kind` is chosen AND working. A broken provider is not "the" provider for its jobs. */
export async function providerIs(userId: string, kind: LocationProviderKind): Promise<boolean> {
  const state = await getLocationProvider(userId);
  return state.kind === kind && state.status === "ok";
}

/**
 * Choose a provider. Raises `rev` when the choice changes (choosing what is
 * already chosen changes nothing). Moves, copies and deletes nothing.
 */
export async function setLocationProvider(
  userId: string,
  kind: LocationProviderKind
): Promise<{ kind: LocationProviderKind; rev: number }> {
  if (kind === "dawarich" && !(await hasOwnDawarich(userId, await readRow(userId)))) {
    throw new AppError(
      "Dawarich needs your own connection before it can be your location source",
      409,
      "DAWARICH_NOT_CONFIGURED"
    );
  }
  if (kind === "travtrack" && !(await travTrackAvailable(userId))) {
    throw new AppError("TravTrack is not available on this server", 409, "TRAVTRACK_UNAVAILABLE");
  }

  // The row may not exist yet; one INSERT … ON CONFLICT DO NOTHING (see web-prefs).
  await prisma.userSettings.createMany({
    data: [{ userId, data: {} as unknown as Prisma.InputJsonValue }],
    skipDuplicates: true,
  });
  // One conditional UPDATE per case, so two concurrent switches cannot both
  // raise rev from the same value or lose one another's choice. Leaving
  // TravTrack also records when (`travtrackLeftAt`, read by the OwnTracks and
  // Overland ingest); coming back clears it; a switch between two other
  // providers leaves it as it was.
  await prisma.$transaction([
    prisma.userSettings.updateMany({
      where: { userId, locationProvider: "travtrack", NOT: { locationProvider: kind } },
      data: {
        locationProvider: kind,
        locationProviderRev: { increment: 1 },
        travtrackLeftAt: new Date(),
      },
    }),
    prisma.userSettings.updateMany({
      where: { userId, NOT: { locationProvider: kind } },
      data: {
        locationProvider: kind,
        locationProviderRev: { increment: 1 },
        ...(kind === "travtrack" ? { travtrackLeftAt: null } : {}),
      },
    }),
  ]);
  const row = await prisma.userSettings.findUniqueOrThrow({
    where: { userId },
    select: { locationProviderRev: true },
  });
  return { kind, rev: row.locationProviderRev };
}

/**
 * Until when OwnTracks and Overland positions are TravTrack's (TravTrack plan
 * E9): every time while the provider is `travtrack`; positions recorded before
 * the moment it left, once it did; none for an account that never chose it.
 * In epoch milliseconds, exclusive.
 */
export async function travTrackAcceptsBefore(userId: string): Promise<number> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { locationProvider: true, travtrackLeftAt: true },
  });
  if (row?.locationProvider === "travtrack") return Infinity;
  return row?.travtrackLeftAt?.getTime() ?? -Infinity;
}
