/**
 * The sections of the web app's per-user display preferences (forgejo#200).
 *
 * The server's half of the registry. Which preferences follow the user, and
 * WHY each one does or stays on its device, is decided in the frontend's
 * `lib/webPrefs/registry.ts` — that is the one place the choice is argued.
 * This file only knows the section NAMES and a loose, bounded shape for each,
 * so the column cannot become a dumping ground: an unknown section is dropped,
 * a known one must have the right top-level kind and stay inside the depth,
 * width and byte bounds below.
 *
 * "Loose" on purpose. The web owns these values and evolves them release by
 * release (a new map field, a new table); a strict server-side schema would
 * have to ship in lockstep with every one of those changes or reject them.
 * The bounds are what keeps a single account from parking megabytes here.
 *
 * Adding a section: a name here AND an entry in the frontend registry. A
 * section only the frontend knows is dropped by the server and reported back
 * in `dropped`, which the sync logs — it does not fail silently.
 */

/** Section name → the JSON kind its value must have at the top level. */
export const WEB_PREF_SECTIONS = {
  /** `mapAppearance.v2` minus its per-device chrome (colour modes live here too). */
  mapAppearance: "object",
  /** `globeChrome.v1` — globe auto-rotation and day/night shading. */
  globeChrome: "object",
  /** `domainColors.v2` — the per-domain colour overrides. */
  domainColors: "object",
  /** `travstats.dashboard.hiddenDomains.v1` — the dashboard domain filter. */
  dashboardHiddenDomains: "array",
  /** `theme-storage` — the map theme. */
  theme: "object",
  /** `stats-compare-storage` — the year-over-year comparison toggle. */
  statsCompare: "object",
  /** `stats.hiddenSections.<tab>` — hidden statistics blocks, keyed by tab. */
  statsHiddenSections: "object",
  /** `travstats:table-hidden-columns:*` and `travstats:table-sort:*`. */
  tablePrefs: "object",
} as const;

export type WebPrefSection = keyof typeof WEB_PREF_SECTIONS;

export const WEB_PREF_SECTION_NAMES = Object.keys(WEB_PREF_SECTIONS) as WebPrefSection[];

export function isWebPrefSection(name: string): name is WebPrefSection {
  return Object.prototype.hasOwnProperty.call(WEB_PREF_SECTIONS, name);
}

/**
 * Bounds. Estimated from the fields these blobs carry today, not measured on
 * a real account: the largest, `mapAppearance.v2`, is a few dozen scalars and
 * a handful of RGB triples — a kilobyte or two. 16 KB per section and 64 KB
 * for the account leave an order of magnitude of headroom and still refuse
 * bloat.
 */
export const WEB_PREFS_LIMITS = {
  /** Serialized bytes of one section's value. */
  sectionMaxBytes: 16 * 1024,
  /** Serialized bytes of everything the account stores. */
  totalMaxBytes: 64 * 1024,
  /** Nesting depth below a section's top level. */
  maxDepth: 6,
  /** Keys in one object, items in one array. */
  maxWidth: 256,
  /** Characters in one string. */
  maxStringLength: 1024,
  /** Entries in one PUT's `sections` map (known or not). */
  maxSectionsPerRequest: 32,
} as const;

/**
 * Why a value is refused, or `null` when it is within bounds and has its
 * section's top-level kind. Iterative, so a hostile nesting depth cannot
 * exhaust the stack before the depth bound is checked.
 */
export function webPrefValueProblem(section: WebPrefSection, value: unknown): string | null {
  const kind = WEB_PREF_SECTIONS[section];
  if (kind === "array" && !Array.isArray(value)) return "must be an array";
  if (kind === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) {
    return "must be an object";
  }

  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (node === null || typeof node === "boolean") continue;
    if (typeof node === "number") {
      if (!Number.isFinite(node)) return "contains a non-finite number";
      continue;
    }
    if (typeof node === "string") {
      if (node.length > WEB_PREFS_LIMITS.maxStringLength) return "contains an over-long string";
      continue;
    }
    if (typeof node !== "object") return "contains a non-JSON value";
    if (depth >= WEB_PREFS_LIMITS.maxDepth) return "is nested too deeply";
    const children = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>);
    if (children.length > WEB_PREFS_LIMITS.maxWidth) return "has too many entries";
    if (!Array.isArray(node)) {
      const longKey = Object.keys(node as Record<string, unknown>).some(
        (k) => k.length > WEB_PREFS_LIMITS.maxStringLength
      );
      if (longKey) return "contains an over-long key";
    }
    for (const child of children) stack.push({ node: child, depth: depth + 1 });
  }

  if (byteLength(value) > WEB_PREFS_LIMITS.sectionMaxBytes) return "is too large";
  return null;
}

export function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}
