import { canonicalizeCompanionName, searchableCompanionName } from "../../utils/companionName";

/**
 * Who a document's reading says it is for — phase D7 of
 * docs/superpowers/specs/2026-11-21-document-links.md. Pure: names in, a
 * verdict out, so the parse hook and the tests share one rule.
 *
 * The rule abstains rather than guesses (a wrong "für: Norbert" on a ticket is
 * worse than none): exactly ONE distinct person named, and exactly ONE
 * candidate (the owner or one companion) fits that name.
 */

/** Keys a reading may carry passenger names under, at any depth. */
const NAME_KEYS = new Set([
  "passengername",
  "passengernames",
  "passengers",
  "copassengers",
  "guestname",
  "guestnames",
  "guests",
  "travellernames",
  "travelernames",
  "travellers",
]);

const TITLES = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "mstr",
  "dr",
  "prof",
  "herr",
  "frau",
  "hr",
  "fr",
  "chd",
  "inf",
]);
const MAX_DEPTH = 6;
const MAX_NAMES = 20;

function pushNames(value: unknown, out: string[]): void {
  if (out.length >= MAX_NAMES) return;
  if (typeof value === "string") {
    // A list in one string: "Max Mustermann, Erika Musterfrau".
    for (const part of value.split(/[;,\n]/)) if (part.trim()) out.push(part.trim());
  } else if (Array.isArray(value)) {
    for (const item of value) pushNames(item, out);
  } else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.name === "string") out.push(o.name);
    else if (typeof o.firstName === "string" && typeof o.lastName === "string") {
      out.push(`${o.firstName} ${o.lastName}`);
    }
  }
}

/** Every passenger name a stored reading holds, as printed. Bounded; never throws. */
export function extractPassengerNames(payload: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || out.length >= MAX_NAMES || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (NAME_KEYS.has(key.toLowerCase())) pushNames(value, out);
      else walk(value, depth + 1);
    }
  };
  walk(payload, 0);
  return out;
}

/**
 * The comparable tokens of a printed name. Boarding passes print
 * "SURNAME/FIRSTNAME MR": the slash form is reordered and the title dropped.
 */
export function nameTokens(raw: string): string[] {
  const slash = raw.includes("/") ? raw.split("/") : null;
  const ordered = slash ? `${slash.slice(1).join(" ")} ${slash[0]}` : raw;
  return searchableCompanionName(ordered)
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !TITLES.has(t));
}

/** Whether a printed name is this person: the same tokens, or (two or more) all of theirs. */
export function nameFits(printed: readonly string[], person: readonly string[]): boolean {
  if (printed.length === 0 || person.length === 0) return false;
  const set = new Set(printed);
  if (person.length === 1) return printed.length === 1 && set.has(person[0]);
  return person.every((t) => set.has(t));
}

export interface MatchPerson {
  id: string;
  name: string;
}

export type PassengerVerdict =
  | { kind: "companion"; companionId: string }
  /** The owner's own name: the document stays "mine" (companion null). */
  | { kind: "owner" }
  /** Several people named, or none fits, or two fit: left for the user to pick. */
  | { kind: "none"; names: string[] };

export function matchPassengers(
  names: readonly string[],
  owner: string | null,
  companions: readonly MatchPerson[]
): PassengerVerdict {
  const distinct = new Map<string, string[]>();
  for (const raw of names) {
    const tokens = nameTokens(raw);
    if (tokens.length > 0) distinct.set(canonicalizeCompanionName(tokens.sort().join(" ")), tokens);
  }
  const printed = [...distinct.values()];
  if (printed.length !== 1) return { kind: "none", names: [...names] };
  const ownerTokens = owner ? nameTokens(owner) : [];
  const fits: PassengerVerdict[] = [];
  if (nameFits(printed[0], ownerTokens)) fits.push({ kind: "owner" });
  for (const c of companions) {
    if (nameFits(printed[0], nameTokens(c.name))) {
      fits.push({ kind: "companion", companionId: c.id });
    }
  }
  return fits.length === 1 ? fits[0] : { kind: "none", names: [...names] };
}
