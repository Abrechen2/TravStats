import { prisma } from "../../db";
import { iso, ledgeredRowIds, writeRows, type LedgerEntry, type RowWrite } from "./core";

/**
 * Rail journeys (ADR 0002 phase 3b). Rail has stored real instants and the
 * station zones since it was built, so only the precision columns are new.
 *
 * One class needs a question: a journey stored WITHOUT a zone. Until the
 * resolver fix of 2026-09-26 a failed zone lookup was read as "no zone", and
 * the station's wall clock was then stored as if it were UTC — so the stored
 * instant of such a row may be off by the station's offset. The backfill does
 * not re-derive it (that would be a guess about what the user typed): the
 * precision says `unknown` and the owner is asked.
 */

interface RailRow {
  id: string;
  userId: string;
  departureTime: Date;
  arrivalTime: Date | null;
  depTimezone: string | null;
  arrTimezone: string | null;
}

function end(
  time: Date,
  zone: string | null,
  columnName: string
): {
  precision: "minute" | "unknown";
  entry: LedgerEntry;
} {
  const kept = { columnName, legacyValue: iso(time), newValue: iso(time), zone };
  return zone
    ? { precision: "minute", entry: { ...kept, rule: "rail.instant_kept", reason: null } }
    : {
        precision: "unknown",
        entry: { ...kept, rule: "rail.instant_without_zone", reason: "instant_without_zone" },
      };
}

function railWrite(row: RailRow): RowWrite {
  const dep = end(row.departureTime, row.depTimezone, "departure");
  const arr = row.arrivalTime ? end(row.arrivalTime, row.arrTimezone, "arrival") : null;
  return {
    rowId: row.id,
    userId: row.userId,
    data: { depPrecision: dep.precision, ...(arr && { arrPrecision: arr.precision }) },
    entries: arr ? [dep.entry, arr.entry] : [dep.entry],
  };
}

export async function backfillRail() {
  const done = await ledgeredRowIds("rail_journeys");
  const rows = await prisma.railJourney.findMany({
    where: { depPrecision: null },
    select: {
      id: true,
      userId: true,
      departureTime: true,
      arrivalTime: true,
      depTimezone: true,
      arrTimezone: true,
    },
    orderBy: { id: "asc" },
  });
  return writeRows(
    "rail_journeys",
    rows.filter((r) => !done.has(r.id)).map(railWrite),
    (id, data) => prisma.railJourney.update({ where: { id }, data })
  );
}
