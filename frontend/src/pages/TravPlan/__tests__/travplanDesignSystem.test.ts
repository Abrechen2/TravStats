import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * TravPlan was built beside the design system rather than on it: 52 raw
 * `<button>`s, a private class system in `travplan.css` with its own button,
 * card and form recipes, hardcoded hex — and, worst, a `:root` rule that
 * redefined the app's GLOBAL accent tokens while a plan was open, so every
 * primitive on the page drew in a colour nobody had decided.
 *
 * These are absolute rules, not ratchets: the screens were rebuilt on the
 * primitives, so there is no list of today's offenders to freeze.
 */
const SRC = resolve(__dirname, "../../..");
const DIR = resolve(__dirname, "..");

function files(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__") files(full, acc);
      continue;
    }
    acc.push(full);
  }
  return acc;
}

const scanned = [resolve(SRC, "pages/TravPlanPage.tsx"), ...files(DIR)];
const rel = (file: string) => relative(SRC, file).split(sep).join("/");
const read = (file: string) => readFileSync(file, "utf8");
const offenders = (pattern: RegExp, only = (_f: string) => true) =>
  scanned
    .filter(only)
    .filter((f) => pattern.test(read(f)))
    .map(rel);
const tsx = (f: string) => f.endsWith(".tsx");

describe("TravPlan is drawn with the design system", () => {
  it("finds the screens to judge — otherwise the scan has drifted and passes silently", () => {
    expect(scanned.filter(tsx).length).toBeGreaterThan(10);
  });

  it("draws no raw <button> — Button, Chip, Segmented and the link helper do that", () => {
    expect(offenders(/<button\b/, tsx)).toEqual([]);
  });

  it("draws no raw select or textarea, and no raw input but a checkbox", () => {
    expect(offenders(/<(select|textarea)\b/, tsx)).toEqual([]);
    const inputs = scanned
      .filter(tsx)
      .flatMap((f) =>
        [...read(f).matchAll(/<input\b[^>]*?>/gs)]
          .filter((m) => !/type="checkbox"/.test(m[0]))
          .map(() => rel(f))
      );
    expect(inputs).toEqual([]);
  });

  it("contains no hex colour", () => {
    expect(offenders(/#[0-9a-fA-F]{3,8}\b/)).toEqual([]);
  });

  it("carries no stylesheet of its own, so it cannot redefine a global token", () => {
    expect(scanned.filter((f) => f.endsWith(".css")).map(rel)).toEqual([]);
    expect(offenders(/import\s+["'][^"']+\.css["']/)).toEqual([]);
    expect(offenders(/data-travplan-mode|travplanMode/)).toEqual([]);
  });

  it("writes no pixel sizes — spacing comes from the --ts-space tokens", () => {
    expect(offenders(/\b\d+px\b/)).toEqual([]);
    expect(
      offenders(/\b(fontSize|padding|margin\w*|gap|borderRadius|width|height)\s*:\s*\d/, tsx)
    ).toEqual([]);
  });

  it("builds every screen from the primitives in components/ui", () => {
    const screens = scanned.filter(tsx).filter((f) => /<[A-Z]/.test(read(f)));
    expect(screens.filter((f) => !/components\/ui/.test(read(f))).map(rel)).toEqual([]);
  });
});
