import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The selected pills on the place pages drew their tint as a literal
 * rgba(94,194,178,0.1) — the teal POI colour retired in 2.7.0 — under a border
 * and text in the live `--domain-poi`. Every selected pill therefore carried a
 * second, stale hue, and a user's own domain colour never reached the fill.
 * The tint is `--domain-poi-soft`, derived from the same token as the border.
 */
const DIR = path.resolve(__dirname, "..");

describe("place pills tint with the live POI token", () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
  it.each(files)("%s", (file) => {
    const source = fs.readFileSync(path.join(DIR, file), "utf8");
    expect(source).not.toMatch(/94,\s*194,\s*178/);
  });
});
