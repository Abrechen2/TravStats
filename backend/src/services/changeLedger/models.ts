import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { prismaModelFields, type PrismaModelField } from "../openapi/prismaDatamodel";

/**
 * The travel entries whose edits the ledger keeps, by Prisma model. The
 * `entityType` is the ledger's (and the API's) name for it.
 */
export const TRACKED_MODELS = {
  Flight: "flight",
  LodgingStay: "lodgingStay",
  RailJourney: "rail",
  BusJourney: "bus",
  FerryJourney: "ferry",
  RentalBooking: "rental",
  Cruise: "cruise",
  CruiseStop: "cruiseStop",
  Trip: "trip",
  PlaceVisit: "placeVisit",
  TripExpense: "expense",
} as const;

export type TrackedModel = keyof typeof TRACKED_MODELS;
export type EntityType = (typeof TRACKED_MODELS)[TrackedModel];

export const ENTITY_TYPES = Object.values(TRACKED_MODELS) as EntityType[];

export function isTrackedModel(model: string | undefined): model is TrackedModel {
  return model !== undefined && Object.prototype.hasOwnProperty.call(TRACKED_MODELS, model);
}

export function modelOfEntityType(type: string): TrackedModel | null {
  const hit = (Object.entries(TRACKED_MODELS) as [TrackedModel, string][]).find(
    ([, t]) => t === type
  );
  return hit ? hit[0] : null;
}

/** The Prisma delegate name: `RailJourney` → `railJourney`. */
export const delegateOf = (model: TrackedModel): string =>
  model.charAt(0).toLowerCase() + model.slice(1);

/**
 * Fields the ledger never records: keys and bookkeeping, and the derived
 * payloads (geometries, enrichment logs) a refresh rewrites wholesale. A change
 * there is not a correction anybody made, and keeping it would bury the real
 * history under machine rows.
 */
export const IGNORED_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "userId",
  "createdAt",
  "updatedAt",
  "lastModifiedBy",
  "nextApiCheckAt",
  "aerodataboxLastUpdatedUtc",
  "shareKey",
  "importBatchId",
  "enrichmentHistory",
  "actualRoute",
  "geometry",
  "lastMailSentAt",
  "summaryGeneratedAt",
]);

/** Candidate fields for a short name of the entry; the first present ones are joined. */
const LABEL_CANDIDATES = [
  "flightNumber",
  "depIata",
  "arrIata",
  "name",
  "title",
  "trainNumber",
  "lineName",
  "shipName",
  "operator",
  "company",
  "description",
  "category",
];
const LABEL_PARTS = 3;

export interface ModelMeta {
  /** Scalar and enum fields by name. */
  scalars: Map<string, PrismaModelField>;
  labelFields: string[];
  /** The column that names the owning account, or the relation that leads to it. */
  owner: { kind: "column"; field: "userId" } | { kind: "relation"; relation: "cruise" };
  /** The SQL table and each scalar field's column, for the one-round-trip snapshot. */
  table: string;
  columns: Map<string, string>;
}

const SCHEMA_PATH = resolve(__dirname, "..", "..", "..", "prisma", "schema.prisma");
let schemaText: string | null = null;

/** `@@map` and each field's `@map` of one model, read from schema.prisma. */
function sqlNames(model: string): { table: string; columns: Map<string, string> } {
  schemaText ??= readFileSync(SCHEMA_PATH, "utf8");
  const block = new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, "m").exec(schemaText);
  if (!block) throw new Error(`change ledger: no model ${model} in schema.prisma`);
  const columns = new Map<string, string>();
  let table = model;
  for (const raw of block[1].split("\n")) {
    const line = raw.trim();
    const tableMap = /^@@map\("([^"]+)"\)/.exec(line);
    if (tableMap) table = tableMap[1];
    const field = /^([A-Za-z_][A-Za-z0-9_]*)\s+\S/.exec(line);
    if (!field || line.startsWith("@@") || line.startsWith("//")) continue;
    const mapped = /@map\("([^"]+)"\)/.exec(line);
    columns.set(field[1], mapped ? mapped[1] : field[1]);
  }
  return { table, columns };
}

const metaCache = new Map<TrackedModel, ModelMeta>();

export function modelMeta(model: TrackedModel): ModelMeta {
  const cached = metaCache.get(model);
  if (cached) return cached;
  const scalars = new Map(
    prismaModelFields(model)
      .filter((f) => f.kind !== "object")
      .map((f) => [f.name, f] as const)
  );
  const meta: ModelMeta = {
    ...sqlNames(model),
    scalars,
    labelFields: LABEL_CANDIDATES.filter((f) => scalars.has(f)),
    owner: scalars.has("userId")
      ? { kind: "column", field: "userId" }
      : { kind: "relation", relation: "cruise" },
  };
  metaCache.set(model, meta);
  return meta;
}

/** A short name of the entry from its snapshot, or null. */
export function labelOf(meta: ModelMeta, row: Record<string, unknown>): string | null {
  const parts = meta.labelFields
    .map((f) => row[f])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .slice(0, LABEL_PARTS);
  return parts.length > 0 ? parts.join(" · ").slice(0, 160) : null;
}
