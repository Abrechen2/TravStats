import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The shared `input` utility reaches the touch minimum on a coarse pointer
 * (forgejo#249). jsdom evaluates no media queries and lays nothing out, so the
 * guard reads the rule itself: the iPad check of 2026-10-08 measured 38 px
 * fields in every form built on this class, and nothing else would notice the
 * rule going missing.
 */
const CSS_PATH = path.resolve(__dirname, "..", "index.css");

function utilityBlock(css: string, name: string): string {
  const start = css.indexOf(`@utility ${name} {`);
  if (start < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) return css.slice(start, i + 1);
  }
  return "";
}

describe("input utility touch size", () => {
  it("sets the touch minimum height under a coarse pointer", () => {
    const block = utilityBlock(fs.readFileSync(CSS_PATH, "utf-8"), "input");
    expect(block).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*min-height: var\(--ts-size-touch-min\);/
    );
  });
});
