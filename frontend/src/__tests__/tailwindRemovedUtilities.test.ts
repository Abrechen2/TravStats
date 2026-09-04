import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * #289: the add-flight form opened from the map painted the page behind it
 * solid black. Its backdrop said `bg-black bg-opacity-50` — Tailwind 3
 * spelling. This frontend runs Tailwind 4 (`src/index.css` is
 * `@import 'tailwindcss'`), which dropped the `*-opacity-*` utilities in
 * favour of the `/NN` modifier on the colour class itself (`bg-black/50`).
 * A dropped utility does not error; it emits nothing, so the backdrop kept
 * the opaque `bg-black` and lost the dimming. Thirteen sites carried the
 * dead class when this guard was written, one of them (`AirportSeedingModal`)
 * doubly malformed. Every unit test passed while every one of them was
 * opaque — a class name is not something a test sees unless it looks.
 *
 * Source-scanning guards age (a stale one keeps passing after the thing it
 * guards has moved), so this one asserts a count-free property: NO match,
 * listed file:line. It was run against the unfixed tree first and reported
 * exactly the thirteen sites named in #289.
 */

const SRC_ROOT = join(__dirname, "..");
const REMOVED_UTILITY = /\b(bg|text|border|placeholder|divide|ring)-opacity-\d+\b/g;

function tsxFilesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("Tailwind 4: removed utilities", () => {
  it("uses no Tailwind 3 opacity utilities — Tailwind 4 dropped them, and a dead class paints a backdrop opaque (#289)", () => {
    const hits: string[] = [];
    for (const file of tsxFilesUnder(SRC_ROOT)) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const match of line.matchAll(REMOVED_UTILITY)) {
          hits.push(`${relative(SRC_ROOT, file)}:${index + 1}: ${match[0]}`);
        }
      });
    }
    expect(hits, `Tailwind 3 opacity utilities found:\n${hits.join("\n")}`).toEqual([]);
  });
});
