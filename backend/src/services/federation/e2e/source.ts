/** Plaintext is returned exclusively to its logged-in OWNER, who encrypts it in their browser. */
import { prisma } from "../../../db";
import { loadVisibleDomains } from "../../domainVisibility";
import { buildSnapshot, type storedScope } from "../snapshots";
import { localDay } from "../../../shared/time/instant";
import { localWallClockOf, type FlightTimeSemantics } from "../../../utils/timezone";
import { TRAVEL_GRAPH, type NodeSpec } from "./graph";
import inventory from "./fieldInventory.json";
import { rowAssets, type AssetRef } from "./assets";

type Scope = ReturnType<typeof storedScope>;
type Row = Record<string, unknown>;
interface Fields {
  details: string;
  costs: string;
  personal: string;
  photos: string;
  documents: string;
  excluded: string;
}
export const FIELD_INVENTORY: Record<string, Fields> = inventory;
export const words = (s: string) => s.split(" ").filter(Boolean);
export function graphSelect(spec: NodeSpec): Record<string, unknown> {
  const fields = FIELD_INVENTORY[spec.model];
  if (!fields) throw Error(`Unclassified travel model: ${spec.model}`);
  return {
    ...Object.fromEntries(
      Object.values(fields)
        .flatMap(words)
        .map((f) => [f, true])
    ),
    ...Object.fromEntries(
      Object.entries(spec.relations ?? {}).map(([key, child]) => [
        key,
        { select: graphSelect(child) },
      ])
    ),
  };
}
function inYear(row: Row, spec: NodeSpec, year: number | null) {
  if (year === null || !spec.date) return year === null;
  const date = row[spec.date] ?? row.startDate ?? row.checkIn;
  if (!(date instanceof Date)) return false;
  if (spec.model === "Flight")
    return (
      localWallClockOf(
        date,
        row.depTimezone as string | null,
        (row.depTimeSemantics ?? "UTC") as FlightTimeSemantics
      ).year === year
    );
  return spec.zone && typeof row[spec.zone] === "string"
    ? Number(localDay(date, row[spec.zone] as string).slice(0, 4)) === year
    : date.getUTCFullYear() === year;
}
function jsonValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (
    value &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof value.toNumber === "function"
  )
    return value.toNumber();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonValue(v)]));
  return value;
}
/** Default-deny fields and relations. The schema ratchet requires classifying every new field. */
export async function projectRow(
  userId: string,
  row: Row,
  spec: NodeSpec,
  scope: Scope,
  assets: Map<string, AssetRef>
): Promise<Row | null> {
  if (row.userId && row.userId !== userId) return null;
  if (spec.category && !scope[spec.category]) return null;
  if (Object.entries(spec.only ?? {}).some(([k, v]) => row[k] !== v)) return null;
  const fields = FIELD_INVENTORY[spec.model];
  const allowed = [
    ...words(fields.details),
    ...(scope.costs ? words(fields.costs) : []),
    ...(scope.personal ? words(fields.personal) : []),
    ...(scope.photos ? words(fields.photos) : []),
    ...(scope.documents ? words(fields.documents) : []),
  ];
  const result = Object.fromEntries(
    allowed.filter((k) => k in row).map((k) => [k, jsonValue(row[k])])
  );
  for (const [key, child] of Object.entries(spec.relations ?? {})) {
    if (child.category && !scope[child.category]) continue;
    const value = row[key];
    if (Array.isArray(value))
      result[key] = (
        await Promise.all(value.map((r) => projectRow(userId, r as Row, child, scope, assets)))
      ).filter(Boolean);
    else if (value && typeof value === "object")
      result[key] = await projectRow(userId, value as Row, child, scope, assets);
  }
  if (
    (scope.photos &&
      ["TripPhoto", "TripImmichAlbum", "PlaceVisitPhoto", "LodgingPhoto", "Note"].includes(
        spec.model
      )) ||
    (scope.documents && ["Document", "ReceiptUpload"].includes(spec.model))
  ) {
    const refs = await rowAssets(userId, spec.model, row);
    for (const ref of refs) assets.set(ref.key, ref);
    if (refs.length) result.attachments = refs.map((r) => r.key);
  }
  return result;
}
export async function collectComparison(userId: string, scope: Scope) {
  const domains = await loadVisibleDomains(userId),
    fullDomains = domains.every((d) => scope.domains.includes(d));
  const selected = scope.tripIds.length > 0 || !scope.futureTrips;
  const sections: Record<string, unknown[]> = {},
    omitted: string[] = [];
  const assets = new Map<string, AssetRef>();
  if (scope.details) {
    const select = Object.fromEntries(
      Object.entries(TRAVEL_GRAPH)
        .filter(
          ([, spec]) =>
            (!spec.domain || scope.domains.includes(spec.domain)) &&
            (!spec.category || scope[spec.category])
        )
        .map(([key, spec]) => [key, { select: graphSelect(spec) }])
    );
    const ownerReader = prisma.user as unknown as {
      findUniqueOrThrow(args: {
        where: { id: string };
        select: Record<string, unknown>;
      }): Promise<Record<string, Row[]>>;
    };
    const data = await ownerReader.findUniqueOrThrow({ where: { id: userId }, select });
    // Root selection prevents unrelated catalogues, notes, expenses or files from escaping a trip/domain mask.
    const allowedIds = new Set<string>();
    const roots = Object.entries(TRAVEL_GRAPH).filter(
      ([key]) => !["documents", "bookings", "tripExpenses", "receiptUploads"].includes(key)
    );
    const deferred = Object.entries(TRAVEL_GRAPH).filter(([key]) =>
      ["documents", "bookings", "tripExpenses", "receiptUploads"].includes(key)
    );
    for (const [key, spec] of [...roots, ...deferred]) {
      if (!data[key]) continue;
      // Shared rows can describe several domains. Only the full-domain grant includes them.
      if (!spec.domain && !fullDomains) {
        omitted.push(key);
        continue;
      }
      const rows: Row[] = [];
      for (const row of data[key]) {
        const tripId = spec.model === "Trip" ? row.id : row.tripId;
        const linked = [
          "flightId",
          "cruiseId",
          "lodgingStayId",
          "placeVisitId",
          "railJourneyId",
          "busJourneyId",
          "ferryJourneyId",
          "rentalBookingId",
          "tripExpenseId",
        ].some((k) => typeof row[k] === "string" && allowedIds.has(row[k] as string));
        const fixedOK =
          !selected ||
          scope.tripIds.includes(String(tripId)) ||
          linked ||
          (scope.allExisting &&
            !tripId &&
            row.createdAt instanceof Date &&
            row.createdAt <= new Date(scope.acceptedAt));
        if (!fixedOK) continue;
        if (scope.year !== null && !inYear(row, spec, scope.year) && !linked) {
          if (!spec.date) omitted.push(key);
          continue;
        }
        // A year-specific trip must not carry child records from a different year or undated attachments.
        const boundedSpec =
          scope.year === null
            ? spec
            : {
                ...spec,
                relations: Object.fromEntries(
                  Object.entries(spec.relations ?? {}).filter(
                    ([name]) =>
                      ![
                        "journalEntries",
                        "photos",
                        "immichAlbums",
                        "stops",
                        "tracks",
                        "legs",
                      ].includes(name)
                  )
                ),
              };
        if (
          scope.year !== null &&
          Object.keys(spec.relations ?? {}).length !==
            Object.keys(boundedSpec.relations ?? {}).length
        )
          omitted.push(`${key}.undated-or-multi-year-children`);
        const projected = await projectRow(userId, row, boundedSpec, scope, assets);
        if (projected) {
          rows.push(projected);
          if (typeof row.id === "string") allowedIds.add(row.id);
        }
      }
      sections[key] = rows;
    }
  }
  return {
    version: 2 as const,
    asOf: new Date().toISOString(),
    scope,
    snapshot: await buildSnapshot(userId, scope, scope.year),
    sections,
    assets: [...assets.values()],
    omitted: [...new Set(omitted)],
  };
}
