import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REGISTRY_PAGES } from "../../pages/Settings/registry/data";

/**
 * UAT rc.45: copy sent people to "Administration → Externe Dienste" and
 * "Admin → Instanz" — menus that no longer exist since the settings were
 * rebuilt into areas and pages. A path in the copy must name a real page:
 * "Einstellungen → Server → <page>" (EN "Settings → Server → <page>").
 */
const RESOURCES = path.resolve(__dirname, "..", "resources");

function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(strings);
  if (node && typeof node === "object") return Object.values(node).flatMap(strings);
  return [];
}

const copy = (lang: "de" | "en"): string[] =>
  fs
    .readdirSync(path.join(RESOURCES, lang))
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => strings(JSON.parse(fs.readFileSync(path.join(RESOURCES, lang, f), "utf8"))));

describe("menu paths in the copy name pages that exist", () => {
  it.each(["de", "en"] as const)("%s: no path through the retired admin menus", (lang) => {
    expect(copy(lang).filter((s) => /\bAdmin(istration)? →/.test(s))).toEqual([]);
  });

  it.each([
    ["de", "Einstellungen → Server → "],
    ["en", "Settings → Server → "],
  ] as const)("%s: every settings path ends on a server page", (lang, prefix) => {
    const pages = REGISTRY_PAGES.filter((p) => p.area === "server").map((p) => p[lang]);
    const broken = copy(lang)
      .flatMap((s) => s.split(prefix).slice(1))
      .filter((rest) => !pages.some((page) => rest.startsWith(page)));
    expect(broken).toEqual([]);
  });
});
