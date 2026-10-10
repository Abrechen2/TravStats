import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Visible keyboard focus (forgejo#249). jsdom draws nothing and matches no
 * `:focus-visible`, so the guard reads the rule itself. The system ring alone
 * — accent at 18 % — measured 1.42:1 against `surface`, which is no visible
 * focus at all on a tablet; the accent outline is what carries it.
 */
const CSS = fs.readFileSync(path.resolve(__dirname, "..", "index.css"), "utf-8");

function rule(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  if (start < 0) return "";
  return CSS.slice(start, CSS.indexOf("}", start) + 1);
}

describe("the system focus style", () => {
  it("draws a solid accent outline under :focus-visible, not only the faint ring", () => {
    const block = rule(":focus-visible");
    expect(block).toMatch(/outline:\s*2px solid var\(--ts-accent\);/);
    expect(block).not.toMatch(/outline:\s*none/);
    expect(block).toMatch(/box-shadow:\s*var\(--ts-shadow-focus-ring\);/);
  });
});
