import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Task 10 rename regression guard: `--domain-hotel*` was the old (pre-brand-
 * rename) CSS custom property name for the lodging domain accent. Every
 * consumer (`TripDetailPage.tsx`, `LodgingDetailPage.tsx`) already reads
 * `var(--domain-lodging, #d4778f)` — always falling back to the hardcoded
 * default because the CSS var itself was never renamed. This keeps the old
 * name from silently reappearing.
 */
const CSS_PATH = path.resolve(__dirname, "..", "index.css");

describe("index.css domain accent variables", () => {
  it("no longer defines --domain-hotel*", () => {
    const content = fs.readFileSync(CSS_PATH, "utf-8");
    expect(content).not.toMatch(/--domain-hotel/);
  });

  it("defines --domain-lodging with the brand rose #d4778f", () => {
    const content = fs.readFileSync(CSS_PATH, "utf-8");
    expect(content).toMatch(/--domain-lodging:\s*#d4778f;/);
    expect(content).toMatch(/--domain-lodging-soft:\s*rgba\(212,\s*119,\s*143,\s*0\.1\);/);
    expect(content).toMatch(/--domain-lodging-locked:\s*rgba\(212,\s*119,\s*143,\s*0\.18\);/);
  });
});
