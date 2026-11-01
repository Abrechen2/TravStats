/**
 * The one write path for the home (plan `2026-11-01-home-one-source`).
 *
 * The residence of the current home period IS the home place, so every write
 * to the periods can move a shared TravTrack route's privacy circle. Each
 * writer — `PUT /settings/personal`, the home-airports routes, a move — runs
 * through here: under the TravTrack lock and the settings row lock, in one
 * transaction, it (1) decides from the row it just locked, (2) records the home
 * being replaced (the `travtrack_share_past_homes` trigger fires on the
 * `home_place` column, so the column first takes the home being replaced and
 * then the new one) and (3) narrows the stored share snapshots. If the
 * narrowing fails, the home does not change.
 */
import { prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { defaultSettings } from "../../routes/settings/types";
import { legacyHistoryOf, type HomePeriod } from "../../utils/homeAirport";
import { takeTravTrackLock } from "../travtrack/lock";
import { narrowShareSnapshots } from "../travtrack/shareNarrow";
import { deriveHomePlace, type DerivedHomePlace } from "./homePlace";
import { HOME_PERIODS_KEY, LEGACY_HISTORY_KEY, homePeriodsFromData } from "./homeStore";

export interface LockedSettings {
  /** The settings blob as locked. */
  blob: Record<string, unknown>;
  /** The legacy `home_place` column as locked. */
  homePlaceColumn: unknown;
  /** The home place as derived from the locked row. */
  before: DerivedHomePlace;
  periods: HomePeriod[];
}

/** Run `fn` in a transaction holding the TravTrack lock and the user's settings row lock. */
export async function withLockedHomeSettings<T>(
  userId: string,
  fn: (tx: DbTransaction, locked: LockedSettings) => Promise<T>
): Promise<T> {
  await prisma.userSettings.createMany({
    data: [{ userId, data: { ...defaultSettings } as unknown as Prisma.InputJsonValue }],
    skipDuplicates: true,
  });
  return prisma.$transaction(
    async (tx) => {
      await takeTravTrackLock(tx, userId);
      const rows = await tx.$queryRaw<Array<{ data: unknown; home_place: unknown }>>`
        SELECT data, home_place FROM user_settings WHERE user_id = ${userId} FOR UPDATE`;
      const blob = (rows[0]?.data ?? {}) as Record<string, unknown>;
      const homePlaceColumn = rows[0]?.home_place ?? null;
      const before = await deriveHomePlace({ data: blob, homePlace: homePlaceColumn });
      return fn(tx, { blob, homePlaceColumn, before, periods: await homePeriodsFromData(blob) });
    },
    { timeout: 60_000 }
  );
}

const samePlace = (a: DerivedHomePlace["homePlace"], b: DerivedHomePlace["homePlace"]): boolean =>
  a === b || (!!a && !!b && a.name === b.name && a.lat === b.lat && a.lon === b.lon);

/** Residences present in `old` and absent from `next`, each once, as stored home places. */
function removedResidences(
  old: readonly HomePeriod[],
  next: readonly HomePeriod[]
): NonNullable<DerivedHomePlace["homePlace"]>[] {
  const kept = new Set(
    next.flatMap((p) => (p.residence ? [`${p.residence.lat},${p.residence.lon}`] : []))
  );
  const out = new Map<string, NonNullable<DerivedHomePlace["homePlace"]>>();
  for (const p of old) {
    const r = p.residence;
    if (!r) continue;
    const key = `${r.lat},${r.lon}`;
    if (!kept.has(key)) out.set(key, { name: r.name, lat: r.lat, lon: r.lon, zone: null });
  }
  return [...out.values()];
}

/**
 * Store `periods` (with the legacy mirror and any `extra` blob keys), record
 * the replaced home and narrow shared routes. Call inside `withLockedHomeSettings`.
 */
export async function commitHomePeriods(
  tx: DbTransaction,
  userId: string,
  locked: LockedSettings,
  periods: readonly HomePeriod[],
  extra: Record<string, unknown> = {}
): Promise<void> {
  const { before } = locked;
  // Homes the write takes away: the home being replaced and the residence of
  // every period that is edited out or deleted. The `home_place` trigger
  // records whatever the column held before a change, so the column walks
  // through each of them, then settles on the new home.
  const gone = removedResidences(locked.periods, periods).filter(
    (r) => !samePlace(r, before.homePlace)
  );
  const walk = [...(before.homePlace ? [before.homePlace] : []), ...gone];
  for (const place of walk) {
    await tx.userSettings.updateMany({ where: { userId }, data: { homePlace: place } });
  }
  const data = {
    ...locked.blob,
    ...extra,
    [HOME_PERIODS_KEY]: periods,
    [LEGACY_HISTORY_KEY]: legacyHistoryOf(periods),
  };
  await tx.userSettings.update({
    where: { userId },
    data: { data: data as unknown as Prisma.InputJsonValue },
  });
  const after = await deriveHomePlace({ data, homePlace: locked.homePlaceColumn });
  if (!samePlace(walk.at(-1) ?? before.homePlace, after.homePlace)) {
    // The column follows the new home (null when none is left).
    await tx.userSettings.updateMany({
      where: { userId },
      data: { homePlace: after.homePlace ?? Prisma.DbNull },
    });
  }
  await narrowShareSnapshots(tx, userId);
}

/** Replace the periods through `change` (null = nothing to change); returns the new list or null. */
export async function updateHomePeriods(
  userId: string,
  change: (periods: readonly HomePeriod[]) => HomePeriod[] | null
): Promise<HomePeriod[] | null> {
  return withLockedHomeSettings(userId, async (tx, locked) => {
    const next = change(locked.periods);
    if (next) await commitHomePeriods(tx, userId, locked, next);
    return next;
  });
}
