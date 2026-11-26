import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Inline help stays one line (owner, 2026-11-26: "nobody reads the big text
 * blocks"). Before this guard, 248 description/hint/help/intro strings ran past
 * 120 characters — the longest 728 — because every rule that asked for an
 * explanation ("a failure must reach the user as itself", provenance, "say why
 * instead of drawing a broken button") was met with another paragraph, and no
 * one owned the copy as a whole. See `docs/ui-copy-audit-2026-11.md`.
 *
 * Which strings count is decided by key NAME, so a new key is covered the day
 * it is added:
 *
 * - inline help — a key ending in `description`, `hint`, `help`, `intro` (or
 *   `…Description`, `…Hint`, `…Help`, `…Intro`), plus the settings rows' `s`
 *   sub-line — may hold {@link INLINE_LIMIT} characters in either locale;
 * - its detail slot, a key ending in `More`, is what the ⓘ toggletip shows
 *   (`InfoLine`, `SettingRow.more`, `SectionTitle.descriptionMore`) and may
 *   hold {@link MORE_LIMIT}.
 *
 * A string that must stay longer goes into the baseline with its length and a
 * reason. The baseline is a ratchet: an entry may not grow, and an entry that
 * now fits (or whose key is gone) fails until it is removed.
 */

export const INLINE_LIMIT = 120;
export const MORE_LIMIT = 400;

const PLURAL = "(_(zero|one|two|few|many|other))?$";
const INLINE_KEY = new RegExp(
  `(^|[a-z])(description|hint|help|intro|Description|Hint|Help|Intro)${PLURAL}`
);
const MORE_KEY = new RegExp(`More${PLURAL}`);
/** The settings rows' catalogue names its one-line sub-label `s`. */
const SETTINGS_ROWS_SUB = new RegExp(`^s${PLURAL}`);

export interface BaselineEntry {
  length: number;
  reason: string;
}
export type Baseline = Record<string, BaselineEntry>;

export interface LongString {
  id: string;
  length: number;
  limit: number;
}

/** The limit a key falls under, or null when it is not help copy. */
export function limitFor(namespace: string, key: string): number | null {
  if (MORE_KEY.test(key)) return MORE_LIMIT;
  if (INLINE_KEY.test(key)) return INLINE_LIMIT;
  if (namespace === "settingsRows" && SETTINGS_ROWS_SUB.test(key)) return INLINE_LIMIT;
  return null;
}

/** Every governed string over its limit, as `<locale>/<namespace>:<dotted.key>`. */
export function findLongStrings(
  locale: string,
  namespace: string,
  tree: unknown,
  prefix = ""
): LongString[] {
  if (!tree || typeof tree !== "object") return [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (typeof value !== "string") return findLongStrings(locale, namespace, value, dotted);
    const limit = limitFor(namespace, key);
    return limit !== null && value.length > limit
      ? [{ id: `${locale}/${namespace}:${dotted}`, length: value.length, limit }]
      : [];
  });
}

/** What is wrong, measured against the baseline: one message per failure. */
export function ratchet(found: LongString[], baseline: Baseline): string[] {
  const problems: string[] = [];
  const byId = new Map(found.map((f) => [f.id, f]));
  for (const f of found) {
    const entry = baseline[f.id];
    if (!entry) {
      problems.push(
        `${f.id}: ${f.length} characters, limit ${f.limit} — shorten it or move the rest behind an ⓘ`
      );
    } else if (f.length > entry.length) {
      problems.push(`${f.id}: grew from ${entry.length} to ${f.length} characters`);
    }
  }
  for (const [id, entry] of Object.entries(baseline)) {
    if (!entry.reason?.trim()) problems.push(`${id}: baseline entry without a reason`);
    if (!byId.has(id)) problems.push(`${id}: fits now (or is gone) — remove it from the baseline`);
  }
  return problems;
}

const RESOURCES_ROOT = path.resolve(__dirname, "..", "resources");

function scanLocale(locale: string): LongString[] {
  const dir = path.join(RESOURCES_ROOT, locale);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((file) =>
      findLongStrings(
        locale,
        file.replace(/\.json$/, ""),
        JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as unknown
      )
    );
}

describe("inline help length", () => {
  it("keeps every description/hint/help/intro string to one line in DE and EN", () => {
    const baseline = JSON.parse(
      fs.readFileSync(path.join(__dirname, "inlineHelpLength.baseline.json"), "utf-8")
    ) as Baseline;
    const found = [...scanLocale("de"), ...scanLocale("en")];
    expect(ratchet(found, baseline)).toEqual([]);
  });

  describe("the rule itself", () => {
    it("governs help keys by name and leaves other copy alone", () => {
      expect(limitFor("admin", "description")).toBe(INLINE_LIMIT);
      expect(limitFor("track", "googleHint")).toBe(INLINE_LIMIT);
      expect(limitFor("places", "intro_other")).toBe(INLINE_LIMIT);
      expect(limitFor("settingsRows", "s")).toBe(INLINE_LIMIT);
      expect(limitFor("track", "googleHintMore")).toBe(MORE_LIMIT);
      expect(limitFor("errors", "message")).toBeNull();
      expect(limitFor("admin", "s")).toBeNull();
      expect(limitFor("stats", "exclusions")).toBeNull();
    });

    it("fails a long intro paragraph that is not in the baseline", () => {
      const long = "x".repeat(INLINE_LIMIT + 1);
      const found = findLongStrings("de", "track", { imports: { intro: long, title: long } });
      expect(found).toEqual([
        { id: "de/track:imports.intro", length: INLINE_LIMIT + 1, limit: INLINE_LIMIT },
      ]);
      expect(ratchet(found, {})).toHaveLength(1);
    });

    it("holds a baseline exception to its length and fails it once it is stale", () => {
      const found = [{ id: "de/a:b.help", length: 150, limit: INLINE_LIMIT }];
      expect(ratchet(found, { "de/a:b.help": { length: 150, reason: "warning" } })).toEqual([]);
      expect(ratchet(found, { "de/a:b.help": { length: 140, reason: "warning" } })).toHaveLength(1);
      expect(ratchet([], { "de/a:b.help": { length: 150, reason: "warning" } })).toHaveLength(1);
      expect(ratchet(found, { "de/a:b.help": { length: 150, reason: " " } })).toHaveLength(1);
    });
  });
});
