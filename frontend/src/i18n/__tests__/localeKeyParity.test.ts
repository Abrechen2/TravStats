import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A missing translation key is silent. react-i18next does not throw and does
 * not fall back to the other locale — it renders the key itself, so a German
 * string added without its English mirror ships a user-facing
 * "tours.leg.mode.ferry" instead of copy. TypeScript cannot see it (the
 * resources are plain JSON), a render test only sees the namespaces it
 * happens to touch, and nobody reviews the EN file when they are writing
 * German. That combination is why the language policy says DE and EN move
 * together, and this suite is what enforces it.
 *
 * Two earlier guards (`lodgingImportKeys.test.ts`) compare the lodging and
 * import trees the same way. They stay — they carry namespace-specific
 * assertions besides parity — but they only covered 2 of 26 namespaces, and
 * the gap was invisible precisely because the guarded namespaces were green.
 *
 * The namespace list is read from the FILESYSTEM, never from a hardcoded
 * array or from `config.ts`'s imports: a new namespace must be covered the
 * day it is added, not the day someone remembers to extend this file. For the
 * same reason there is no allow-list of "known" one-sided keys — the policy
 * forbids leaving one side stale, so a key that exists in one locale only is
 * a failure by definition, not a state to be recorded.
 */

const RESOURCES_ROOT = path.resolve(__dirname, "..", "resources");
const DE_DIR = path.join(RESOURCES_ROOT, "de");
const EN_DIR = path.join(RESOURCES_ROOT, "en");

function listNamespaceFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function readNamespace(dir: string, file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as unknown;
}

/**
 * Flattens a resource tree to dotted leaf paths. Arrays are walked like
 * objects, with their index as the path segment — deliberately, because a
 * three-entry EN list beside a four-entry DE list is the same drift as a
 * missing key: the fourth item renders as a raw path.
 *
 * An empty object or array yields its own path rather than nothing, so a
 * branch that exists but is empty on one side still shows up in the diff
 * instead of vanishing into a zero-length key set.
 */
function flattenKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return [prefix];
  return entries.flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key));
}

function difference(a: readonly string[], b: readonly string[]): string[] {
  const known = new Set(b);
  return a.filter((key) => !known.has(key)).sort();
}

const deFiles = listNamespaceFiles(DE_DIR);
const enFiles = listNamespaceFiles(EN_DIR);

describe("DE/EN translation resources", () => {
  it("ships the same set of namespace files in both locales", () => {
    const missingInEn = difference(deFiles, enFiles);
    const missingInDe = difference(enFiles, deFiles);
    const report = [
      ...missingInEn.map((file) => `  missing file: en/${file}`),
      ...missingInDe.map((file) => `  missing file: de/${file}`),
    ];
    expect(report, `Namespace files differ between locales:\n${report.join("\n")}`).toEqual([]);
  });

  // Guards the scan itself: an empty resources directory (a bad path, a moved
  // folder) would otherwise make every assertion below pass vacuously.
  it("found namespaces to check", () => {
    expect(deFiles.length).toBeGreaterThan(0);
  });

  // One test per namespace so a failure names the namespace in its title and
  // the offending key paths in its message — actionable without opening a
  // single JSON file.
  const sharedFiles = deFiles.filter((file) => enFiles.includes(file));
  for (const file of sharedFiles) {
    const namespace = file.replace(/\.json$/, "");

    it(`"${namespace}" has identical key sets in de and en`, () => {
      const deKeys = flattenKeys(readNamespace(DE_DIR, file));
      const enKeys = flattenKeys(readNamespace(EN_DIR, file));

      const missingInEn = difference(deKeys, enKeys);
      const missingInDe = difference(enKeys, deKeys);
      const report = [
        ...missingInEn.map((key) => `  missing in en/${file}: ${key}`),
        ...missingInDe.map((key) => `  missing in de/${file}: ${key}`),
      ];

      expect(
        report,
        `DE/EN key drift in namespace "${namespace}" ` +
          `(${missingInEn.length} missing in EN, ${missingInDe.length} missing in DE):\n` +
          report.join("\n")
      ).toEqual([]);
    });
  }
});
