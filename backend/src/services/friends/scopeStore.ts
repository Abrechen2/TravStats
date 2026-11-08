/**
 * The comparison scope behind the leaderboard switch (spec 2026-11-08 §11.4). `LeaderboardConsent`
 * survives only as the STORAGE of that scope: one row per owner and viewer, `accepted` while the
 * connection's leaderboard switch is on, `withdrawn` while it is off — and the scope stays on the
 * row either way. Switching off and on again therefore restores what the owner chose, it never
 * widens it to "everything"; a row whose scope is missing or does not parse is read as "not
 * shared" (`readScope`), so a damaged scope fails closed.
 */
import { prisma, type DbTransaction } from "../../db";
import { METRIC_GROUPS } from "../../shared/comparisonMetrics";
import type { LeaderboardScope } from "../../schemas/comparison";
import { loadVisibleDomains } from "../domainVisibility";
import { scopeJson } from "../comparison/consents";

/** Who looks at the owner's numbers: an account here, or a leaderboard friend on another server. */
export type ScopeViewer = { viewerId: string } | { remoteId: string };

/** Every group and every domain the owner has visible: the default of a new connection (§11.2.3). */
export async function defaultScope(ownerId: string): Promise<LeaderboardScope> {
  return { groups: [...METRIC_GROUPS], domains: await loadVisibleDomains(ownerId), year: null };
}

const whereOf = (ownerId: string, viewer: ScopeViewer) =>
  "viewerId" in viewer
    ? { ownerId_viewerId: { ownerId, viewerId: viewer.viewerId } }
    : { ownerId_remoteId: { ownerId, remoteId: viewer.remoteId } };

type Db = Pick<DbTransaction, "leaderboardConsent">;

/**
 * Make the stored consent follow the switch. On: accepted, the stored scope kept; the default
 * only where nothing was ever granted (no row, or a row that was never accepted and carries no
 * scope). Off: withdrawn, scope kept.
 */
export async function applyLeaderboardSwitch(
  db: Db,
  ownerId: string,
  viewer: ScopeViewer,
  on: boolean,
  fallback: LeaderboardScope
): Promise<void> {
  const where = whereOf(ownerId, viewer);
  const now = new Date();
  const existing = await db.leaderboardConsent.findUnique({ where });
  if (!on) {
    if (existing && existing.status !== "withdrawn")
      await db.leaderboardConsent.update({
        where: { id: existing.id },
        data: { status: "withdrawn", decidedAt: now },
      });
    return;
  }
  if (!existing) {
    await db.leaderboardConsent.create({
      data: { ownerId, ...viewer, status: "accepted", scope: scopeJson(fallback), decidedAt: now },
    });
    return;
  }
  const neverGranted = existing.scope === null && existing.status !== "accepted";
  await db.leaderboardConsent.update({
    where: { id: existing.id },
    data: {
      status: "accepted",
      decidedAt: now,
      ...(neverGranted ? { scope: scopeJson(fallback) } : {}),
    },
  });
}

/**
 * Store the scope the owner chose, whatever the switch says. The status is not touched: a scope
 * edited while the switch is off waits for it. No row yet: one is created in the state the switch
 * is in.
 */
export async function storeScope(
  db: Db,
  ownerId: string,
  viewer: ScopeViewer,
  scope: LeaderboardScope,
  switchOn: boolean
): Promise<void> {
  const where = whereOf(ownerId, viewer);
  const existing = await db.leaderboardConsent.findUnique({ where });
  const now = new Date();
  if (!existing) {
    await db.leaderboardConsent.create({
      data: {
        ownerId,
        ...viewer,
        status: switchOn ? "accepted" : "withdrawn",
        scope: scopeJson(scope),
        decidedAt: now,
      },
    });
    return;
  }
  await db.leaderboardConsent.update({
    where: { id: existing.id },
    data: { scope: scopeJson(scope), decidedAt: now },
  });
}

/** The owner's stored scope for one viewer, as a reader may use it (null: none or damaged). */
export async function readStoredScope(
  ownerId: string,
  viewer: ScopeViewer
): Promise<unknown | null> {
  const row = await prisma.leaderboardConsent.findUnique({
    where: whereOf(ownerId, viewer),
    select: { scope: true },
  });
  return row?.scope ?? null;
}
