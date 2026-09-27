import { prisma } from "../../db";
import { iso, ledgeredRowIds, placeZone, writeRows, type RowWrite } from "./core";
import { readLegacyVisit } from "./visitRule";

/**
 * Place visits (ADR 0002 phase 3b, Q4). The zone is the place's (a place
 * always has coordinates); the writer — and with it what `visitedAt` means —
 * comes from `visitRule.ts`. `written_via` is left as it is: the backfill
 * infers a writer, it does not know one, and that column records knowledge.
 */

/** When each user's first paired device (a Companion) was minted. */
async function firstDeviceByUser(): Promise<Map<string, Date>> {
  const rows = await prisma.apiToken.groupBy({
    by: ["userId"],
    where: { deviceId: { not: null } },
    _min: { createdAt: true },
  });
  const map = new Map<string, Date>();
  for (const r of rows) if (r._min.createdAt) map.set(r.userId, r._min.createdAt);
  return map;
}

export async function backfillPlaceVisits() {
  const done = await ledgeredRowIds("place_visits");
  const rows = await prisma.placeVisit.findMany({
    where: { visitedAt: { not: null }, visitedPrecision: null },
    select: {
      id: true,
      userId: true,
      visitedAt: true,
      createdAt: true,
      writtenVia: true,
      place: { select: { lat: true, lon: true } },
    },
    orderBy: { id: "asc" },
  });
  const firstDevice = await firstDeviceByUser();
  const writes: RowWrite[] = rows
    .filter((r) => !done.has(r.id))
    .map((row) => {
      const stored = row.visitedAt as Date;
      const place = placeZone({ lat: row.place.lat, lon: row.place.lon });
      const reading = readLegacyVisit({
        stored,
        createdAt: row.createdAt,
        writtenVia: row.writtenVia,
        firstDeviceAt: firstDevice.get(row.userId) ?? null,
        zone: place.zone,
      });
      return {
        rowId: row.id,
        userId: row.userId,
        data: {
          visitedAtUtc: reading.utc,
          visitedZone: place.zone,
          visitedPrecision: reading.precision,
        },
        entries: [
          {
            columnName: "visited_at",
            legacyValue: iso(stored),
            newValue: reading.utc ? iso(reading.utc) : null,
            zone: place.zone,
            rule: reading.rule,
            reason: place.reason ?? reading.reason,
          },
        ],
      };
    });
  return writeRows("place_visits", writes, (id, data) =>
    prisma.placeVisit.update({ where: { id }, data })
  );
}
