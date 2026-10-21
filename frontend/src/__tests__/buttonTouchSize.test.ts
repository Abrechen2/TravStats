import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * beta.22 UAT on an iPad: "Speichern" and "Verbindung testen" on the services
 * page measured 36-38 px — every button built on the shared `btn` utility
 * (btn-primary, btn-secondary, btn-danger). The utility reaches the touch
 * minimum on a coarse pointer only, as the `input` utility does (forgejo#249),
 * so the desktop keeps its density. jsdom evaluates no media query, so the
 * guard reads the rule.
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

describe("btn utility touch size", () => {
  it("sets the touch minimum height under a coarse pointer", () => {
    const block = utilityBlock(fs.readFileSync(CSS_PATH, "utf-8"), "btn");
    expect(block).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*min-height: var\(--ts-size-touch-min\);/
    );
  });
});
