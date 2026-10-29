import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { isSharedDemoUser } from "../../utils/sharedDemo";
import { getInstanceSettings } from "../instanceSettingsService";
import { travTrackConfig } from "./config";

/**
 * Whether TravTrack exists on this server, and for whom (TravTrack plan, T1).
 *
 * Two switches, both the admin's: the instance's beta switch (TravTrack is
 * `travTrack` in the web's beta registry) and TravTrack's own
 * `travtrack_config.enabled`. The beta switch alone OFFERS it — the admin can
 * reach TravTrack's own switch, as `/travplan/config` sits behind
 * `assertTravPlanOffered` only. Both together turn it ON: capture, views and
 * derivations.
 *
 * Per-user activation is choosing provider `travtrack`; there is no third
 * switch. The shared demo account never gets it — its history would be every
 * visitor's.
 *
 * Switched off is not deleted: an account that holds TravTrack data keeps its
 * summary, export and delete (`holdsTravTrackData`, the `held` tier in
 * `routes/travtrack/gate.ts`). "TravTrack aus heißt: keine neue Erfassung,
 * nichts wird gelöscht, Export und Löschen bleiben möglich."
 */

const disabled = (): AppError =>
  new AppError("TravTrack is switched off on this server", 403, "TRAVTRACK_DISABLED");

export async function travTrackOffered(): Promise<boolean> {
  return (await getInstanceSettings()).betaFeaturesEnabled;
}

export async function assertTravTrackOffered(): Promise<void> {
  if (!(await travTrackOffered())) throw disabled();
}

/** Offered AND switched on by the admin: the server captures, shows and derives. */
export async function travTrackInstanceOn(): Promise<boolean> {
  const [offered, config] = await Promise.all([travTrackOffered(), travTrackConfig()]);
  return offered && config.enabled;
}

/**
 * `travTrackInstanceOn` read inside a transaction (TravTrack plan E3, Codex
 * review): a derivation that publishes asks it after taking the TravTrack
 * lock, so a switch-off that lands while it waited commits nothing of it.
 * Read-only — no settings row is created here; without one nothing is offered.
 */
export async function travTrackInstanceOnIn(tx: DbTransaction): Promise<boolean> {
  const admin = await tx.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { betaFeaturesEnabled: true },
  });
  if (!admin?.betaFeaturesEnabled) return false;
  return (await travTrackConfig(tx)).enabled;
}

export async function assertTravTrackOn(): Promise<void> {
  if (!(await travTrackInstanceOn())) throw disabled();
}

/**
 * Whether this account holds anything TravTrack stored for it: points, zones,
 * reported gaps, deleted spans and points, file imports or a live ingest token. One `EXISTS` per table, the
 * first hit wins. An import counts even without points (owner, 2026-10-25):
 * a failed import must stay visible and deletable while TravTrack is off.
 * A deleted span counts — it is what keeps a late upload out, and the user
 * may want to see it in the summary. A live ingest token counts so it can be
 * listed and revoked while TravTrack is off; otherwise it would stay usable the
 * day TravTrack is switched on again.
 */
export async function holdsTravTrackData(userId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ hit: number }[]>`
    SELECT 1 AS hit FROM travtrack_points WHERE user_id = ${userId}
    UNION ALL SELECT 1 FROM travtrack_privacy_zones WHERE user_id = ${userId}
    UNION ALL SELECT 1 FROM travtrack_gaps WHERE user_id = ${userId}
    UNION ALL SELECT 1 FROM travtrack_deleted_ranges WHERE user_id = ${userId}
    UNION ALL SELECT 1 FROM travtrack_deleted_points WHERE user_id = ${userId}
    UNION ALL SELECT 1 FROM travtrack_imports WHERE user_id = ${userId}
    UNION ALL SELECT 1 FROM travtrack_ingest_tokens WHERE user_id = ${userId} AND revoked_at IS NULL
    UNION ALL SELECT 1 FROM travtrack_diagnostic_events WHERE user_id = ${userId}
    LIMIT 1`;
  return rows.length > 0;
}

/** Whether this account may use TravTrack now: the instance is on and it is not the demo. */
export async function travTrackAvailable(userId: string): Promise<boolean> {
  if (!(await travTrackInstanceOn())) return false;
  return !(await isSharedDemoUser(userId));
}
