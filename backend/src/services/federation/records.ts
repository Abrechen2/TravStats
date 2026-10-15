import { z } from "zod";
import type { ComparisonLink } from "../../prisma";
import { prisma } from "../../db";
import { localDay } from "../../shared/time/instant";
import { localWallClockOf, type FlightTimeSemantics } from "../../utils/timezone";
import { loadVisibleDomains } from "../domainVisibility";
import { RECORD_FIELDS, type RecordDomain } from "./recordFields";
import { currentGrant, storedScope, assertUnchanged, audit } from "./snapshots";
import { refused } from "./security";

export const recordPageSchema = z.strictObject({
  domain: z.enum(Object.keys(RECORD_FIELDS) as [RecordDomain, ...RecordDomain[]]),
  nextCursor: z.string().uuid().nullable(),
  rows: z
    .array(
      z.strictObject({
        key: z.string().uuid(),
        fields: z
          .array(
            z.strictObject({
              name: z.string().max(100),
              value: z.union([z.string().max(50_000), z.number().finite(), z.boolean(), z.null()]),
            })
          )
          .max(200),
      })
    )
    .max(100),
});
export type RecordPage = z.infer<typeof recordPageSchema>;
type Row = Record<string, unknown> & { id: string };
type ReadDelegate = { findMany: (input: unknown) => Promise<Row[]> };
/** Domain dispatch is a closed server-owned map, never a peer-supplied Prisma model/select. */
export async function sourceRecords(
  link: ComparisonLink,
  audience: string,
  domain: RecordDomain,
  cursor?: string,
  requestedYear: number | null = null
): Promise<RecordPage> {
  const grant = await currentGrant(link, audience);
  const scope = storedScope(grant.scope);
  const result = await buildRecords(
    link.userId,
    { ...scope, year: scope.year ?? requestedYear },
    domain,
    cursor
  );
  await assertUnchanged(link, grant);
  await audit(link, grant, "records");
  return result;
}
export async function buildRecords(
  userId: string,
  scope: ReturnType<typeof storedScope>,
  domain: RecordDomain,
  cursor?: string
): Promise<RecordPage> {
  if (
    !scope.details ||
    !scope.domains.includes(domain) ||
    !(await loadVisibleDomains(userId)).includes(domain)
  )
    throw refused();
  const descriptor = RECORD_FIELDS[domain];
  if (!descriptor) throw refused();
  const allowed = [
    ...descriptor.fields.details,
    ...(scope.costs ? descriptor.fields.costs : []),
    ...(scope.personal ? descriptor.fields.personal : []),
    ...(scope.documents ? descriptor.fields.documents : []),
  ];
  const select = Object.fromEntries(allowed.map((key) => [key, true]));
  const where = {
    userId: userId,
    ...(scope.tripIds.length || !scope.futureTrips
      ? scope.allExisting
        ? {
            OR: [
              { tripId: { in: scope.tripIds } },
              { tripId: null, createdAt: { lte: new Date(scope.acceptedAt) } },
            ],
          }
        : { tripId: { in: scope.tripIds } }
      : {}),
    ...(!scope.futureTrips && !scope.tripIds.length
      ? { createdAt: { lte: new Date(scope.acceptedAt) } }
      : {}),
    ...(cursor ? { id: { gt: cursor } } : {}),
  };
  const delegate = (prisma as unknown as Record<string, ReadDelegate>)[descriptor.model];
  const rows = await delegate.findMany({ where, select, orderBy: { id: "asc" }, take: 101 });
  const page = rows.slice(0, 100);
  const visible = page.filter((row) => {
    if (scope.year === null) return true;
    const date = row[descriptor.date];
    if (!(date instanceof Date)) return false;
    if (domain === "flight")
      return (
        localWallClockOf(
          date,
          typeof row.depTimezone === "string" ? row.depTimezone : null,
          (row.depTimeSemantics ?? "UTC") as FlightTimeSemantics
        ).year === scope.year
      );
    return descriptor.zone
      ? Number(localDay(date, String(row[descriptor.zone] ?? "UTC")).slice(0, 4)) === scope.year
      : date.getUTCFullYear() === scope.year;
  });
  const result = recordPageSchema.parse({
    domain,
    nextCursor: rows.length > 100 ? page.at(-1)!.id : null,
    rows: visible.map((row) => ({
      key: row.id,
      fields: allowed
        .filter((name) => !["id", "createdAt", "updatedAt"].includes(name) && !name.endsWith("Id"))
        .map((name) => {
          const value = row[name];
          return {
            name,
            value:
              value instanceof Date
                ? value.toISOString()
                : Array.isArray(value)
                  ? value.join(", ")
                  : (value ?? null),
          };
        }),
    })),
  });
  return result;
}
