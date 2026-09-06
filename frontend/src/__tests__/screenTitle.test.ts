import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * There is one page heading, and it is `.t-screen-title`.
 *
 * The app carried fourteen different `<h1>` class chains — `text-2xl font-bold
 * mb-2`, `text-3xl font-display font-bold leading-tight`, one in mono, one
 * still reaching for `dark:text-white` on a dark-only app. They differed by
 * size, weight, family and colour, and none of the differences meant anything.
 *
 * The utility comes from `typography.scale.screenTitle` in the token file, so
 * changing what a page heading looks like is a change to `design/tokens.json`
 * and nowhere else.
 */
const SRC = resolve(__dirname, "..");

/** Layout is not type: an h1 may still say where it sits. */
const ALLOWED_EXTRAS = new Set([
  "mb-1",
  "mb-2",
  "mt-1",
  "mt-2",
  "flex",
  "items-center",
  "gap-3",
  "leading-tight",
]);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      sourceFiles(full, acc);
      continue;
    }
    if (entry.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

function headings(): { file: string; classes: string[] }[] {
  const found: { file: string; classes: string[] }[] = [];
  for (const file of sourceFiles(SRC)) {
    const contents = readFileSync(file, "utf8");
    for (const match of contents.matchAll(/<h1\s+className="([^"]*)"/g)) {
      found.push({ file: file.replace(`${SRC}/`, ""), classes: match[1].split(/\s+/) });
    }
  }
  return found;
}

describe("the one page heading", () => {
  it("finds headings at all — otherwise the scan has drifted and passes silently", () => {
    expect(headings().length).toBeGreaterThan(10);
  });

  it("gives every <h1> the .t-screen-title utility", () => {
    const offenders = headings()
      .filter(({ classes }) => !classes.includes("t-screen-title"))
      .map(({ file, classes }) => `${file}: ${classes.join(" ")}`);
    expect(offenders, "a page heading is .t-screen-title").toEqual([]);
  });

  it("lets an <h1> place itself but not restyle itself", () => {
    const offenders: string[] = [];
    for (const { file, classes } of headings()) {
      for (const cls of classes) {
        if (cls === "t-screen-title" || ALLOWED_EXTRAS.has(cls)) continue;
        offenders.push(`${file}: ${cls}`);
      }
    }
    // Size, weight, family and colour come from the token; a margin does not.
    expect(offenders, "these classes restyle a heading instead of placing it").toEqual([]);
  });
});
