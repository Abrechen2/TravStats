import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import i18n, { i18nReady, loadLanguage } from "../config";

/**
 * Perf audit 2026-11, item 10: every namespace of both languages was imported
 * statically into the 2.97 MB entry chunk. The files now load per language.
 */
describe("the translation files load per language", () => {
  it("imports no translation file statically into the entry chunk", () => {
    const source = readFileSync(join(__dirname, "../config.ts"), "utf-8");
    expect(source).not.toMatch(/from\s+["']\.\/resources\//);
    expect(source).toContain(
      'import.meta.glob<{ default: Record<string, unknown> }>("./resources/*/*.json")'
    );
  });

  it("has every namespace of both languages once ready (tests load both)", async () => {
    await i18nReady;
    for (const lng of ["de", "en"]) {
      expect(i18n.hasResourceBundle(lng, "common")).toBe(true);
      expect(i18n.hasResourceBundle(lng, "settingsRows")).toBe(true);
      expect(i18n.hasResourceBundle(lng, "travplan")).toBe(true);
    }
    expect(i18n.getFixedT("de")("settingsRows:maintenance.runtime.title")).toBe("Laufzeit");
  });

  it("loads a language once, however often it is asked for", async () => {
    expect(loadLanguage("de")).toBe(loadLanguage("de"));
    await loadLanguage("de");
  });
});
