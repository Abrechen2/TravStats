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

// UAT rc.46: "Externe Dienste" on Buchungen lesen and "Einstellungen → Instanz" in the
// Timeline tile pointed to menus that are gone, and the Timeline tile and the TravTrack
// import hint gave two different Google export paths.
describe("rc46 menu paths", () => {
  it.each([
    ["de", /Einstellungen → Instanz|unter Externe Dienste\b/],
    ["en", /Settings → Instance|under External services\b/],
  ] as const)("%s: no path to the retired instance or external-services menus", (lang, bad) => {
    expect(copy(lang).filter((s) => bad.test(s))).toEqual([]);
  });

  it.each([
    ["de", "Einstellungen → TravTrack → "],
    ["en", "Settings → TravTrack → "],
  ] as const)("%s: every TravTrack settings path ends on a TravTrack page", (lang, prefix) => {
    const pages = REGISTRY_PAGES.filter((p) => p.area === "track").map((p) => p[lang]);
    const broken = copy(lang)
      .flatMap((s) => s.split(prefix).slice(1))
      .filter((rest) => !pages.some((page) => rest.startsWith(page)));
    expect(broken).toEqual([]);
  });

  // The owner uses an iPhone: both platforms' paths, sourced (Google's help), and the
  // reason the file lives on the phone at all.
  it.each([
    [
      "de",
      [
        "Laut Google-Hilfe",
        "Android „Einstellungen → Standort → Standortdienste → Zeitachse → Zeitachsendaten exportieren“",
        "iPhone „Google Maps → Profilbild → Einstellungen → Persönliche Inhalte → Zeitachsendaten exportieren“",
        "nur",
      ],
    ],
    [
      "en",
      [
        "According to Google's help",
        "Android “Settings → Location → Location services → Timeline → Export Timeline data”",
        "iPhone “Google Maps → profile picture → Settings → Personal content → Export Timeline data”",
        "on the device only",
      ],
    ],
  ] as const)(
    "%s: the Timeline tile and the TravTrack hint give both Google export paths",
    (lang, parts) => {
      const read = (ns: string): Record<string, Record<string, unknown>> =>
        JSON.parse(fs.readFileSync(path.join(RESOURCES, lang, `${ns}.json`), "utf8"));
      // The paths sit behind the ⓘ of each line since the copy diet (2026-11-26).
      const tile = (read("settings").import.timeline as Record<string, string>).descriptionMore;
      const hint = read("track").imports.googleHintMore as string;
      for (const part of parts) {
        expect(tile).toContain(part);
        expect(hint).toContain(part);
      }
    }
  );
});

// UAT rc.46 retest: "Buchungen lesen" (and every page with the pointer) still said
// "… unter Externe Dienste"; the link goes to /settings/dienste and must say so.
describe("external services pointer", () => {
  it.each(["de", "en"] as const)("%s: names the page its link opens", (lang) => {
    const ns = JSON.parse(
      fs.readFileSync(path.join(RESOURCES, lang, "externalServices.json"), "utf8")
    ) as { pointer: { link: string } };
    const page = REGISTRY_PAGES.find((p) => p.id === "dienste");
    expect(page).toBeTruthy();
    expect(ns.pointer.link.endsWith(` → ${page![lang]}`)).toBe(true);
  });
});

// UAT rc.45 retest: copy that named things the app no longer does or spelled them wrong.
describe("retest copy", () => {
  const read = (lang: string, ns: string): unknown =>
    JSON.parse(fs.readFileSync(path.join(RESOURCES, lang, `${ns}.json`), "utf8"));
  it("names no flight as a place a share link is made (flight links are retired)", () => {
    const rows = JSON.stringify(read("de", "settingsRows"));
    expect(rows).not.toContain("Erstellt an Flug");
  });
  it("writes 'öffentliche Adresse' in lower case inside a sentence", () => {
    expect(JSON.stringify(read("de", "settings"))).not.toMatch(/eine Öffentliche Adresse/);
    expect(JSON.stringify(read("de", "settings"))).not.toContain("Admin-Einstellungen");
  });
});
