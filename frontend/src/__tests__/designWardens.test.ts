import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import baseline from "./designWardens.baseline.json";

/**
 * The wardens from `design/DESIGN_SYSTEM.md` §10.
 *
 * "A system that lives only in a document ages like the ones before it." Three
 * of the four are here; the fourth — the generator test — sits beside the
 * generator in `theme/__tests__/tokens.generated.test.ts`.
 *
 * All three are RATCHETS with a frozen list of today's offenders, the shape the
 * repo already uses for file size, OpenAPI coverage and response shapes. Each
 * fails on a NEW offender and equally on a STALE entry, so the lists can only
 * shrink. That is the difference between a warden and a wish: a rule stated
 * against 567 existing violations is a wish, and one that also refuses to let
 * a fixed file stay on the list is a rule with a direction.
 *
 * To take a file off a list: fix it, then run
 * `npx vitest --run designWardens` and remove the name the failure prints.
 */

const SRC = resolve(__dirname, "..");

function sourceFiles(exts: string[], dir = SRC, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      sourceFiles(exts, full, acc);
      continue;
    }
    if (exts.some((ext) => entry.endsWith(ext))) acc.push(full);
  }
  return acc;
}

const rel = (file: string): string => file.replace(`${SRC}/`, "");

/** Compares an offender list against its frozen baseline, in both directions. */
function expectRatchet(offenders: string[], frozen: readonly string[], what: string): void {
  const added = offenders.filter((name) => !frozen.includes(name));
  expect(added, `NEW ${what} — use the token layer instead`).toEqual([]);

  const stale = frozen.filter((name) => !offenders.includes(name));
  expect(stale, `these files no longer have ${what}; drop them from the baseline`).toEqual([]);
}

// ───────────────────────────────────────────────────────────────────────────
describe("warden: no hex literal outside the theme", () => {
  const offenders = sourceFiles([".ts", ".tsx"])
    .filter((file) => !rel(file).startsWith("theme/"))
    .filter((file) => /#[0-9a-fA-F]{6}\b/.test(readFileSync(file, "utf8")))
    .map(rel)
    .sort();

  it("finds files to judge — otherwise the scan has drifted and passes silently", () => {
    expect(offenders.length).toBeGreaterThan(0);
  });

  it("gains no new file that paints instead of reading a token", () => {
    expectRatchet(offenders, baseline.hexLiterals, "hex literals");
  });
});

// ───────────────────────────────────────────────────────────────────────────
const TAILWIND_PALETTE =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|decoration|outline|shadow|divide|placeholder|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

describe("warden: no raw Tailwind palette class", () => {
  const offenders = sourceFiles([".ts", ".tsx"])
    .filter((file) => TAILWIND_PALETTE.test(readFileSync(file, "utf8")))
    .map(rel)
    .sort();

  it("gains no new file painting from Tailwind's palette", () => {
    // `bg-slate-800` is a colour nobody decided. The token layer is the set of
    // colours somebody did.
    expectRatchet(offenders, baseline.tailwindPalette, "raw Tailwind palette classes");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("warden: no dark: variant", () => {
  const offenders = sourceFiles([".ts", ".tsx", ".css"])
    .filter((file) => /\bdark:[\w[\]/.()-]+/.test(readFileSync(file, "utf8")))
    .map(rel)
    .sort();

  it("gains no new dark: variant", () => {
    // TravStats is dark-only and `class="dark"` is fixed in index.html, so a
    // `dark:` variant is a branch that is always taken — and the light branch
    // beside it is a colour nobody has ever seen.
    expectRatchet(offenders, baseline.darkVariants, "dark: variants");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("warden: an overlay lives in the Dialog primitive", () => {
  const offenders = sourceFiles([".tsx"])
    .filter((file) => rel(file) !== "components/ui/Dialog.tsx")
    .filter((file) => /fixed inset-0/.test(readFileSync(file, "utf8")))
    .map(rel)
    .sort();

  it("gains no new hand-rolled overlay", () => {
    // Every one of these is a scrim someone built again: its own radius, its
    // own backdrop, and — the part that matters — its own answer to whether
    // Escape closes it and whether focus can leave it. `components/ui/Dialog`
    // is the shell they migrate onto.
    expectRatchet(offenders, baseline.overlays, "hand-rolled overlays");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("warden: every CSS variable that is read is also defined", () => {
  /**
   * NOT a ratchet — an absolute rule, because it can be.
   *
   * Twelve names were referenced 55 times and defined nowhere. A missing
   * custom property raises no error: the declaration is dropped and the border,
   * the background or the colour simply is not there. That is the quietest
   * class of defect in the app, and it is fully fixable, so it is not frozen —
   * it is closed.
   */
  const definitions = new Set<string>();

  for (const file of sourceFiles([".css"])) {
    for (const match of readFileSync(file, "utf8").matchAll(/(--[\w-]+)\s*:/g)) {
      definitions.add(match[1]);
    }
  }
  // A property may also be set inline, as `style={{ "--pulse-color": … }}` —
  // including with a cast, `["--domain-color" as string]: …`, which is how
  // TypeScript lets a custom property into a `CSSProperties` object.
  for (const file of sourceFiles([".ts", ".tsx"])) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /["'](--[\w-]+)["'](?:\s+as\s+\w+)?\s*\]?\s*:/g
    )) {
      definitions.add(match[1]);
    }
  }

  const references = new Map<string, string[]>();
  for (const file of sourceFiles([".ts", ".tsx", ".css"])) {
    for (const match of readFileSync(file, "utf8").matchAll(/var\(\s*(--[\w-]+)/g)) {
      const name = match[1];
      // Tailwind's own internals are defined by the framework, not by this
      // repo: `--tw-ring-color` and the generated palette it ships
      // (`--color-gray-200`, used as the border-colour compatibility default).
      if (name.startsWith("--tw-") || /^--color-[a-z]+-\d{2,3}$/.test(name)) continue;
      // `token()` builds its name — `var(--ts-${name})` — so the scan reads a
      // prefix rather than a variable. A trailing dash is never a real name.
      if (name.endsWith("-")) continue;
      if (!references.has(name)) references.set(name, []);
      references.get(name)?.push(rel(file));
    }
  }

  it("reads variables at all — otherwise the scan has drifted", () => {
    expect(references.size).toBeGreaterThan(20);
  });

  it("defines every variable it reads", () => {
    const undefinedNames = [...references.entries()]
      .filter(([name]) => !definitions.has(name))
      .map(([name, files]) => `${name} (${[...new Set(files)].slice(0, 3).join(", ")})`)
      .sort();
    expect(undefinedNames, "these render as nothing — no error, just absent").toEqual([]);
  });
});
