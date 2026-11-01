import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * forgejo#88 (acceptance criterion of 2026-09-18): every settings card that
 * names a service outside this server says what happens when it does not
 * answer. Each card's sentence was written from its code path, so this pins
 * that the sentence is WIRED — a new card, or a new provider row, without one
 * fails here instead of shipping silent.
 */
const dir = resolve(__dirname, "..");
const read = (name: string): string => readFileSync(resolve(dir, `${name}.tsx`), "utf8");

const CARDS = ["PhotoJourneyNightlyScanCard", "StravaConnectionCard"];

describe("external-service cards say what happens when the service is unreachable", () => {
  it.each(CARDS)("%s", (name) => {
    expect(read(name)).toMatch(/whenUnreachable=\{t\("settings:unreachable\.\w+"/);
  });
});
