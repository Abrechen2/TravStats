import fs from "fs";
import path from "path";

import { describe, it, expect } from "vitest";

/**
 * An accessible name is user-facing copy, and has to come from a translation.
 *
 * Forgejo #7 found the domain switches in Settings announcing `domain.flight`,
 * `domain.cruise`, `domain.lodging` — the raw i18n keys — while the visible
 * labels beside them were translated correctly. The component passed
 * `aria-label={d.i18nKey}` and rendered `{t(d.i18nKey)}` two lines apart.
 *
 * Sweeping for it turned up eight more in the same shape but the other way
 * round: English literals (`aria-label="close"`, `"required"`, `"Delete"`,
 * `"Join our Discord"`) that a German screen reader announces in English.
 *
 * Neither form is visible on screen, which is why both survived: nothing looks
 * wrong unless you are listening to the page instead of reading it. A unit test
 * cannot catch them either — the test i18n fake returns the KEY, so a
 * translated name and a raw key are the same string in a rendered test.
 *
 * Hence a source scan. It checks the two shapes that are always wrong:
 *   1. `aria-label="…"`          — an English literal, never translated
 *   2. `aria-label={… "text" …}` — an English literal inside an expression,
 *                                  e.g. `{playing ? "Pause" : "Play"}`
 *   3. `aria-label={x.key}`      — a raw i18n key, the #7 shape itself
 *
 * It deliberately does NOT demand a `t(` call in every expression. Most
 * `aria-label={label}` sites take an already-translated prop, and plenty take
 * DATA — an album name, an airline's accessible alt text — which is not copy
 * and must not be translated. A rule that flagged those would be noise, and a
 * noisy guard gets an exception list until it means nothing.
 *
 * If a genuinely untranslatable literal ever appears, add it to ALLOWED with
 * the reason rather than loosening the rule.
 */
const SRC = path.join(__dirname, "..", "..");

/** Literal expressions that are legitimately not copy. Keep this empty if you can. */
const ALLOWED: readonly string[] = [];

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      tsxFiles(full, out);
    } else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

interface Offence {
  file: string;
  line: number;
  text: string;
}

function scan(): { literals: Offence[]; untranslated: Offence[] } {
  const literals: Offence[] = [];
  const untranslated: Offence[] = [];

  for (const file of tsxFiles(SRC)) {
    const rel = path.relative(SRC, file).replace(/\\/g, "/");
    fs.readFileSync(file, "utf-8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/aria-label\s*=\s*"/.test(line)) {
          literals.push({ file: rel, line: i + 1, text: line.trim() });
          return;
        }
        const expr = /aria-label\s*=\s*\{([^}]*)\}/.exec(line);
        if (!expr) return;
        const body = expr[1];
        if (ALLOWED.includes(body.trim())) return;

        // A quoted run of letters inside the expression is English copy that
        // was never handed to a translator — unless it sits inside a t() call,
        // where it is the key.
        const hasBareLiteral = /["'`][A-Za-z][A-Za-z ]+["'`]/.test(body) && !body.includes("t(");
        // An accessible name is never an identifier key. `{d.key}` is what
        // Forgejo #7 announced.
        const looksLikeKey = /\.key\b/.test(body) && !body.includes("t(");

        if (hasBareLiteral || looksLikeKey) {
          untranslated.push({ file: rel, line: i + 1, text: line.trim() });
        }
      });
  }
  return { literals, untranslated };
}

describe("accessible names", () => {
  const { literals, untranslated } = scan();

  it("scans a real tree — the guard itself must not be looking at nothing", () => {
    // A wrong SRC path would make every assertion below pass vacuously.
    expect(tsxFiles(SRC).length).toBeGreaterThan(50);
  });

  it("has no hardcoded aria-label text", () => {
    expect(literals.map((o) => `${o.file}:${o.line}  ${o.text}`)).toEqual([]);
  });

  it("bakes no English text and no raw key into an aria-label expression", () => {
    expect(untranslated.map((o) => `${o.file}:${o.line}  ${o.text}`)).toEqual([]);
  });
});
