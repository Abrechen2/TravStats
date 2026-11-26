/**
 * The purpose catalogue: which detailed purposes exist, and the KIND (private | business) each
 * stands for. The kind is what the column `purpose` stores and what every filter, count and plugin
 * reads; the detailed key lives beside it in `purpose_key`
 * (docs/superpowers/specs/2026-11-22-private-business-purpose.md, "Purpose catalogue").
 *
 * Mirrored at backend/src/shared/purposeCatalogue.ts — change both together; each side has its own
 * test asserting the same table.
 *
 * A key is `builtin:<key>` or `custom:<uuid>`. The legacy values `private` and `business` stay valid
 * forever (older Companion versions send nothing else): they are a kind without a detail, shown as
 * "Privat (sonstiges)" and "Geschäftlich".
 */
import type { Purpose } from "./purpose";

export const BUILTIN_PURPOSES = [
  {
    key: "vacation",
    kind: "private",
    icon: "beach",
    color: "#0EA5E9",
    de: "Urlaub",
    en: "Vacation",
  },
  {
    key: "business",
    kind: "business",
    icon: "briefcase",
    color: "#475569",
    de: "Geschäftlich",
    en: "Business",
  },
  {
    key: "family_friends",
    kind: "private",
    icon: "people",
    color: "#DB2777",
    de: "Familie & Freunde",
    en: "Family & friends",
  },
  {
    key: "short_break",
    kind: "private",
    icon: "backpack",
    color: "#16A34A",
    de: "Kurztrip & Wochenende",
    en: "Short break",
  },
  {
    key: "event",
    kind: "private",
    icon: "ticket",
    color: "#9333EA",
    de: "Veranstaltung",
    en: "Event",
  },
  {
    key: "trade_fair",
    kind: "business",
    icon: "podium",
    color: "#B45309",
    de: "Messe & Konferenz",
    en: "Trade fair & conference",
  },
  {
    key: "education",
    kind: "private",
    icon: "school",
    color: "#2563EB",
    de: "Ausbildung & Studium",
    en: "Education",
  },
  {
    key: "health",
    kind: "private",
    icon: "health",
    color: "#DC2626",
    de: "Gesundheit",
    en: "Health",
  },
  {
    key: "relocation",
    kind: "private",
    icon: "box",
    color: "#78716C",
    de: "Umzug",
    en: "Relocation",
  },
  {
    key: "private_other",
    kind: "private",
    icon: "home",
    color: "#64748B",
    de: "Privat (sonstiges)",
    en: "Private (other)",
  },
] as const satisfies readonly {
  key: string;
  kind: Purpose;
  icon: string;
  color: string;
  de: string;
  en: string;
}[];

export type BuiltinPurposeKey = (typeof BUILTIN_PURPOSES)[number]["key"];

/** The icons a custom purpose may pick; the frontend draws each one. */
export const PURPOSE_ICONS = [
  "beach",
  "briefcase",
  "people",
  "backpack",
  "ticket",
  "podium",
  "school",
  "health",
  "box",
  "home",
  "star",
  "heart",
  "sport",
  "camera",
  "music",
  "food",
] as const;
export type PurposeIcon = (typeof PURPOSE_ICONS)[number];

export const BUILTIN_PREFIX = "builtin:";
export const CUSTOM_PREFIX = "custom:";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a legacy kind means as a detailed key. */
export const DEFAULT_KEY_OF_KIND: Record<Purpose, string> = {
  private: `${BUILTIN_PREFIX}private_other`,
  business: `${BUILTIN_PREFIX}business`,
};

export type ParsedPurposeKey =
  | { type: "legacy"; kind: Purpose }
  | { type: "builtin"; key: string; kind: Purpose }
  | { type: "custom"; key: string; id: string };

const builtinByKey = new Map<string, (typeof BUILTIN_PURPOSES)[number]>(
  BUILTIN_PURPOSES.map((p) => [p.key, p])
);

export const builtinPurpose = (key: string) => builtinByKey.get(key);

/**
 * Reads what a client sent as a purpose: a legacy kind, a built-in key or a custom key. Anything
 * else is null (refused by the schema before it gets here).
 */
export function parsePurposeKey(value: unknown): ParsedPurposeKey | null {
  if (value === "private" || value === "business") return { type: "legacy", kind: value };
  if (typeof value !== "string") return null;
  if (value.startsWith(BUILTIN_PREFIX)) {
    const found = builtinByKey.get(value.slice(BUILTIN_PREFIX.length));
    return found ? { type: "builtin", key: value, kind: found.kind } : null;
  }
  if (value.startsWith(CUSTOM_PREFIX)) {
    const id = value.slice(CUSTOM_PREFIX.length);
    return UUID.test(id)
      ? { type: "custom", key: `${CUSTOM_PREFIX}${id.toLowerCase()}`, id: id.toLowerCase() }
      : null;
  }
  return null;
}

export const isPurposeValue = (value: unknown): boolean => parsePurposeKey(value) !== null;

/**
 * The detailed key an entry shows. A stored key whose kind no longer matches the stored kind is
 * stale (an older client changed the kind without knowing the detail) and gives way to the kind's
 * default. `customKind` answers the kind of a custom key; unknown custom keys fall back as well.
 */
export function effectivePurposeKey(
  purpose: string | null | undefined,
  purposeKey: string | null | undefined,
  customKind?: (id: string) => Purpose | undefined
): string | null {
  if (purpose !== "private" && purpose !== "business") return null;
  const parsed = parsePurposeKey(purposeKey);
  if (parsed?.type === "builtin" && parsed.kind === purpose) return parsed.key;
  if (parsed?.type === "custom" && customKind?.(parsed.id) === purpose) return parsed.key;
  return DEFAULT_KEY_OF_KIND[purpose];
}

/** The detailed purpose a trip's category suggests for a new entry inside it. */
export function purposeKeyFromTripCategory(category: string | null | undefined): string | null {
  switch (category) {
    case "business":
      return `${BUILTIN_PREFIX}business`;
    case "vacation":
      return `${BUILTIN_PREFIX}vacation`;
    case "weekend":
      return `${BUILTIN_PREFIX}short_break`;
    case "family":
      return `${BUILTIN_PREFIX}family_friends`;
    default:
      return null;
  }
}
