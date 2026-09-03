import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUGGESTION_ANCHOR_KINDS } from "../../types/placeList";

/**
 * `localeKeyParity` catches a key present in one locale and missing in the
 * other. It cannot catch a key missing from BOTH — and that is exactly what
 * happened here: the backend grew a fifth suggestion anchor (`photo`), the
 * frontend's union kept four, and `ChecklistRow` renders
 * `places:checklist.anchor.${anchorKind}`. Every photo suggestion therefore
 * printed the raw key on screen, in German and in English alike, while the
 * whole suite stayed green.
 *
 * So this guard compares the copy against the KIND LIST rather than against
 * the other locale. The list is imported, never re-typed: a test that restates
 * the rule it is checking passes the day the rule changes and the code does
 * not. Adding a kind to `SUGGESTION_ANCHOR_KINDS` without its two sentences
 * fails here, which is the day it should fail.
 *
 * The placeholders are asserted too. A sentence that drops {{label}} still
 * renders, still reads like copy, and silently stops naming the evidence the
 * user is supposed to judge — "you were probably here" with nothing to check
 * is the one thing the anchor exists to prevent.
 */

const RESOURCES_ROOT = path.resolve(__dirname, "..", "resources");
const LOCALES = ["de", "en"] as const;
const REQUIRED_PLACEHOLDERS = ["{{distance}}", "{{label}}"] as const;

function readAnchorCopy(locale: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(RESOURCES_ROOT, locale, "places.json"), "utf-8");
  const parsed = JSON.parse(raw) as { checklist?: { anchor?: Record<string, unknown> } };
  return parsed.checklist?.anchor ?? {};
}

describe("suggestion anchor copy", () => {
  for (const locale of LOCALES) {
    describe(locale, () => {
      const anchor = readAnchorCopy(locale);

      it.each([...SUGGESTION_ANCHOR_KINDS])("translates the %s anchor", (kind) => {
        const sentence = anchor[kind];
        expect(typeof sentence, `places:checklist.anchor.${kind} is missing in ${locale}`).toBe(
          "string"
        );
        expect(String(sentence).trim().length).toBeGreaterThan(0);
      });

      it.each([...SUGGESTION_ANCHOR_KINDS])("names distance and evidence for %s", (kind) => {
        const sentence = String(anchor[kind] ?? "");
        for (const placeholder of REQUIRED_PLACEHOLDERS) {
          expect(sentence, `${locale} ${kind} lost ${placeholder}`).toContain(placeholder);
        }
      });

      // A kind removed from the list but left in the copy is dead weight that
      // reads as supported. Same ratchet, other direction.
      it("carries no sentence for a kind that no longer exists", () => {
        expect(Object.keys(anchor).sort()).toEqual([...SUGGESTION_ANCHOR_KINDS].sort());
      });
    });
  }

  it("gives an unnamed photo its own fallback", () => {
    // A photo labels itself with its trip, and needs no trip — so the empty
    // label is the normal case. The generic fallback claims "a recorded
    // place", which is the one thing a shutter GPS fix is not.
    for (const locale of LOCALES) {
      const raw = fs.readFileSync(path.join(RESOURCES_ROOT, locale, "places.json"), "utf-8");
      const parsed = JSON.parse(raw) as { checklist?: Record<string, unknown> };
      const fallback = parsed.checklist?.anchorUnnamedPhoto;
      expect(typeof fallback, `anchorUnnamedPhoto is missing in ${locale}`).toBe("string");
      expect(fallback).not.toBe(parsed.checklist?.anchorUnnamed);
    }
  });
});
