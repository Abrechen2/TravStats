import { Prisma } from "../../prisma";
import { PURPOSES, type Purpose } from "../../shared/purpose";
import {
  BUILTIN_PREFIX,
  BUILTIN_PURPOSES,
  DEFAULT_KEY_OF_KIND,
  parsePurposeKey,
} from "../../shared/purposeCatalogue";

/**
 * "Nach Zweck filtern": one purpose a list, the trips list or the dashboard is narrowed to
 * (`?purposeFilter=`, read by the entry scope in `services/provenance/recordedOnly.ts`). The value
 * is a detailed key, a whole kind (`private` | `business`) or `unknown` (no purpose).
 *
 * A filter answers the same question the chip does (`effectivePurposeKey`): a row with no detail,
 * or with a built-in detail of the other kind (stale), shows as its kind's default — so filtering
 * on "Geschäftlich" finds those rows too, and filtering on "Messe & Konferenz" does not.
 */
export type PurposeFilter =
  | { type: "unknown" }
  | { type: "kind"; kind: Purpose }
  | {
      type: "key";
      key: string;
      /** A custom key's kind is known once the request is authenticated (`withOwnerPurposes`). */
      kind: Purpose | null;
      isDefault: boolean;
      /** The owner's custom keys of the other kind: stale on a row of this kind (default only). */
      staleCustomKeys?: string[];
    };

export const PURPOSE_FILTER_UNKNOWN = "unknown";

/** Reads a filter value; `invalid` for anything that names no purpose. */
export function parsePurposeFilter(raw: unknown): PurposeFilter | "invalid" {
  if (raw === PURPOSE_FILTER_UNKNOWN) return { type: "unknown" };
  if (typeof raw === "string" && (PURPOSES as readonly string[]).includes(raw)) {
    return { type: "kind", kind: raw as Purpose };
  }
  const parsed = parsePurposeKey(raw);
  if (parsed?.type === "builtin") {
    return {
      type: "key",
      key: parsed.key,
      kind: parsed.kind,
      isDefault: DEFAULT_KEY_OF_KIND[parsed.kind] === parsed.key,
    };
  }
  if (parsed?.type === "custom")
    return { type: "key", key: parsed.key, kind: null, isDefault: false };
  return "invalid";
}

/**
 * The filter completed with the owner's own purposes: a custom key learns its kind, and a default
 * key learns which custom keys read as stale on its kind — the same rule `effectivePurposeKey`
 * applies to a chip, so the filter, the chip and the usage counts agree.
 */
export function withOwnerPurposes(
  f: PurposeFilter,
  customs: readonly { id: string; kind: string }[]
): PurposeFilter {
  if (f.type !== "key") return f;
  if (f.kind === null) {
    const own = customs.find((c) => `custom:${c.id}` === f.key);
    return own ? { ...f, kind: own.kind as Purpose } : f;
  }
  if (!f.isDefault) return f;
  return {
    ...f,
    staleCustomKeys: customs.filter((c) => c.kind !== f.kind).map((c) => `custom:${c.id}`),
  };
}

/** The built-in keys whose kind is not `kind`: a stored detail of those is stale on a `kind` row. */
const otherKindKeys = (kind: Purpose): string[] =>
  BUILTIN_PURPOSES.filter((p) => p.kind !== kind).map((p) => `${BUILTIN_PREFIX}${p.key}`);

/** The filter as a Prisma `where` on a purpose model. Every branch names `purpose`. */
export function purposeFilterWhere(f: PurposeFilter): Record<string, unknown> {
  if (f.type === "unknown") return { purpose: null };
  if (f.type === "kind") return { purpose: f.kind };
  // A custom key that is not the owner's has no kind: it matches nothing.
  if (f.kind === null) return { purpose: { not: null }, purposeKey: f.key, id: { in: [] } };
  if (!f.isDefault) return { purpose: f.kind, purposeKey: f.key };
  return {
    purpose: f.kind,
    OR: [
      { purposeKey: null },
      { purposeKey: { in: [f.key, ...otherKindKeys(f.kind), ...(f.staleCustomKeys ?? [])] } },
    ],
  };
}

/** The same condition in SQL, for the raw reads (the lodging list). */
export function purposeFilterSql(alias: string, f: PurposeFilter): Prisma.Sql {
  const a = Prisma.raw(alias);
  if (f.type === "unknown") return Prisma.sql`${a}.purpose IS NULL`;
  if (f.type === "kind") return Prisma.sql`${a}.purpose = ${f.kind}`;
  if (f.kind === null) return Prisma.sql`FALSE`;
  if (!f.isDefault) return Prisma.sql`(${a}.purpose = ${f.kind} AND ${a}.purpose_key = ${f.key})`;
  const keys = [f.key, ...otherKindKeys(f.kind), ...(f.staleCustomKeys ?? [])];
  return Prisma.sql`(${a}.purpose = ${f.kind} AND (${a}.purpose_key IS NULL OR ${a}.purpose_key IN (${Prisma.join(keys)})))`;
}
