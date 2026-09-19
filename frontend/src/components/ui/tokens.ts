import type { DomainKey } from "../../shared/domains";

/**
 * Helpers that let a primitive compute a shade WITHOUT knowing a colour value.
 *
 * The status-pill recipe is "colour as text, background at 12 %, border at
 * 45 %" — three shades of one hue. Written out as literals that would be three
 * hex values per status, twenty-four in total, none of them in the token file.
 * `color-mix` keeps the single input and derives the rest, so a hue that
 * changes in `design/tokens.json` changes everywhere at once.
 */
export function alpha(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** A CSS custom property reference, so callers never type `var(--ts-…)`. */
export function token(name: string): string {
  return `var(--ts-${name})`;
}

/**
 * The status vocabulary, mapped onto the token palette.
 *
 * The app carries more states than the Companion does; the extra ones are not
 * new colours but synonyms, and saying so here is what stops a fourth table
 * from inventing a fourth blue. `in_progress` and `completed` take the flown
 * colour exactly as the Companion's own `StatusPill` does.
 */
export const STATUS_TOKEN: Record<string, string> = {
  scheduled: "status-scheduled",
  booked: "status-scheduled",
  pending: "status-pending",
  flown: "status-flown",
  completed: "status-flown",
  in_progress: "status-flown",
  cancelled: "status-cancelled",
  historical: "status-historical",
  duplicated: "status-duplicated",
  review: "status-review",
  guess: "status-guess",
};

/**
 * `pending` is provisional, and the design system says provisional is a dashed
 * border. It is the only status that carries the dash.
 */
export const DASHED_STATUSES = new Set(["pending", "guess"]);

export const DOMAIN_TOKEN: Record<DomainKey | "tour", string> = {
  flight: "domain-flight",
  cruise: "domain-cruise",
  lodging: "domain-hotel",
  poi: "domain-poi",
  tour: "domain-tour",
};

/**
 * Where mono belongs — codes, identifiers, measurements, timestamps.
 *
 * DESIGN_SYSTEM.md §3.2 states the rule in prose; this is the same rule as a
 * list, so a component can ask rather than guess. Mono is NOT for pills,
 * buttons, names, categories, running text, or a number with a unit inside a
 * sentence.
 */
export const MONO_KEYS: readonly string[] = [
  "iata",
  "icao",
  "flightNumber",
  "registration",
  "modeS",
  "unlocode",
  "imo",
  "mmsi",
  "pnr",
  "bookingReference",
  "distance",
  "duration",
  "altitude",
  "speed",
  "coordinates",
  "zoom",
  "fileSize",
  "timestamp",
  "version",
  "id",
] as const;
