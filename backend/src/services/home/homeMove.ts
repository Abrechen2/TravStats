/**
 * "I moved" as one idempotent append (plan `2026-11-01-home-one-source`,
 * `POST /settings/home-airports/periods`). The Companion's offline outbox may
 * replay a request, so a `clientRef` seen before answers with the stored
 * periods and adds nothing.
 */
import { prisma } from "../../db";
import { takeTravTrackLock } from "../travtrack/lock";
import { narrowShareSnapshots } from "../travtrack/shareNarrow";
import { Prisma } from "../../prisma";
import { defaultSettings } from "../../routes/settings/types";
import { legacyHistoryOf, sortPeriods, type HomePeriod } from "../../utils/homeAirport";
import { HOME_PERIODS_KEY, LEGACY_HISTORY_KEY, homePeriodsFromData } from "./homeStore";

/** Recent client refs per user, in the settings blob next to the periods. */
export const HOME_MOVE_REFS_KEY = "homeMoveRefs";
const MAX_REFS = 50;
/** The whole-list PUT refuses more (`homePeriodsBodySchema`); an append must not outgrow it. */
const MAX_PERIODS = 100;

export type AppendResult =
  | { kind: "created"; periods: HomePeriod[] }
  | { kind: "replayed"; periods: HomePeriod[] }
  | { kind: "overlap"; periods: HomePeriod[] }
  | { kind: "full"; periods: HomePeriod[] };

export interface MoveInput {
  fromDate: string;
  residence: NonNullable<HomePeriod["residence"]>;
  airports: HomePeriod["airports"];
  clientRef: string;
}

/** The periods after a move, or null when `fromDate` is not after everything already recorded. */
export function appendPeriod(periods: readonly HomePeriod[], move: MoveInput): HomePeriod[] | null {
  const open = periods.find((p) => p.toDate === null);
  const latestStart = periods.reduce((m, p) => (p.fromDate > m ? p.fromDate : m), "");
  const latestEnd = periods.reduce((m, p) => (p.toDate && p.toDate > m ? p.toDate : m), "");
  if (open ? move.fromDate <= open.fromDate : move.fromDate < latestEnd) return null;
  if (move.fromDate <= latestStart) return null;
  // `toDate` is exclusive: closing at `fromDate` makes the last day of the old home the day before.
  const closed = periods.map((p) => (p === open ? { ...p, toDate: move.fromDate } : p));
  return sortPeriods([
    ...closed,
    {
      fromDate: move.fromDate,
      toDate: null,
      residence: move.residence,
      residenceConfirmed: true,
      airports: move.airports,
    },
  ]);
}

export async function appendHomePeriod(userId: string, move: MoveInput): Promise<AppendResult> {
  await prisma.userSettings.createMany({
    data: [{ userId, data: { ...defaultSettings } as unknown as Prisma.InputJsonValue }],
    skipDuplicates: true,
  });
  return prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    // Row lock: a replay racing its original must see the first one's ref.
    const rows = await tx.$queryRaw<Array<{ data: unknown }>>`
      SELECT data FROM user_settings WHERE user_id = ${userId} FOR UPDATE`;
    const blob = (rows[0]?.data ?? {}) as Record<string, unknown>;
    const periods = await homePeriodsFromData(blob);
    const refs = Array.isArray(blob[HOME_MOVE_REFS_KEY])
      ? (blob[HOME_MOVE_REFS_KEY] as unknown[]).filter((r): r is string => typeof r === "string")
      : [];
    if (refs.includes(move.clientRef)) return { kind: "replayed", periods };
    if (periods.length >= MAX_PERIODS) return { kind: "full", periods };
    const next = appendPeriod(periods, move);
    if (!next) return { kind: "overlap", periods };
    const data = {
      ...blob,
      [HOME_PERIODS_KEY]: next,
      [LEGACY_HISTORY_KEY]: legacyHistoryOf(next),
      [HOME_MOVE_REFS_KEY]: [...refs, move.clientRef].slice(-MAX_REFS),
    };
    await tx.userSettings.update({
      where: { userId },
      data: { data: data as unknown as Prisma.InputJsonValue },
    });
    // A shared route keeps away from the homes of the new list (same transaction).
    await narrowShareSnapshots(tx, userId);
    return { kind: "created", periods: next };
  });
}
