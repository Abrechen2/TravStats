import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A `t()` call that forgets a variable is silent: i18next leaves the
 * placeholder in, so the German reader sees "mit {{count}} Besuchen". The
 * global test mock returns the key, so no render test can notice either — it
 * shipped on the place page (browser acceptance 2026-09-26).
 *
 * This scans every literal `t("ns:key", …)` call in the source and checks
 * that each `{{variable}}` the German text of that key (or its plural forms)
 * names appears somewhere in the call's arguments. It is a textual check —
 * a spread or a helper that builds the options elsewhere passes it — so it
 * catches the plain omission, which is the one that happened.
 */

const SRC_ROOT = path.resolve(__dirname, "..", "..");
const DE_DIR = path.resolve(__dirname, "..", "resources", "de");
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{\{\s*([\w]+)[^}]*\}\}/g;

function collectVariables(): Map<string, Set<string>> {
  const byKey = new Map<string, Set<string>>();
  const walk = (ns: string, node: Record<string, unknown>, prefix: string): void => {
    for (const [k, v] of Object.entries(node)) {
      const keyPath = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") {
        walk(ns, v as Record<string, unknown>, keyPath);
      } else if (typeof v === "string") {
        const names = [...v.matchAll(PLACEHOLDER)].map((m) => m[1]);
        if (names.length === 0) continue;
        const id = `${ns}:${keyPath.replace(PLURAL_SUFFIX, "")}`;
        const set = byKey.get(id) ?? new Set<string>();
        names.forEach((n) => set.add(n));
        byKey.set(id, set);
      }
    }
  };
  for (const file of fs.readdirSync(DE_DIR).filter((f) => f.endsWith(".json"))) {
    const json = JSON.parse(fs.readFileSync(path.join(DE_DIR, file), "utf-8")) as Record<
      string,
      unknown
    >;
    walk(file.replace(/\.json$/, ""), json, "");
  }
  return byKey;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ["__tests__", "i18n", "generated"].includes(entry.name) ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** The text between the key literal and the call's closing parenthesis. */
function callArguments(src: string, openParen: number, afterKey: number): string {
  let depth = 1;
  let i = openParen + 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") depth -= 1;
    i += 1;
  }
  return src.slice(afterKey, i - 1);
}

describe("t() calls pass every variable their German text needs", () => {
  it("leaves no {{placeholder}} without a value", () => {
    const variables = collectVariables();
    const call = /\bt\(\s*["']([\w-]+:[\w.-]+)["']/g;
    const missing: string[] = [];

    for (const file of sourceFiles(SRC_ROOT)) {
      const src = fs.readFileSync(file, "utf-8");
      for (const m of src.matchAll(call)) {
        const needed = variables.get(m[1]);
        if (!needed) continue;
        const start = m.index ?? 0;
        const args = callArguments(src, src.indexOf("(", start), start + m[0].length);
        const absent = [...needed].filter((v) => !new RegExp(`\\b${v}\\b`).test(args));
        if (absent.length > 0) {
          const line = src.slice(0, start).split("\n").length;
          missing.push(
            `${path.relative(SRC_ROOT, file)}:${line} ${m[1]} lacks ${absent.join(", ")}`
          );
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
