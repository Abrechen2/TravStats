import { describe, it, expect } from "vitest";

import {
  foldForSearch,
  searchSettings,
  splitKeywords,
  type SettingsSearchCandidate,
} from "./settingsSearchMatch";

const candidates: SettingsSearchCandidate[] = [
  {
    section: "security",
    label: "Sicherheit",
    groupLabel: "Konto",
    href: "/settings/account",
    keywords: ["Passwort", "Passkey", "Zwei-Faktor", "2FA"],
  },
  {
    section: "units",
    label: "Einheiten & Formate",
    groupLabel: "Darstellung",
    href: "/settings/account",
    keywords: ["Kilometer", "Meilen", "Währung", "Datumsformat"],
  },
  {
    section: "externalServices",
    label: "Meine externen Dienste",
    groupLabel: "Dienste",
    href: "/settings/account",
    keywords: ["Immich", "Dawarich", "Routing", "Straßenroute"],
  },
];

describe("settings search", () => {
  it("finds a section by a word inside it, and says which word", () => {
    const [hit] = searchSettings("passw", candidates);
    expect(hit.section).toBe("security");
    expect(hit.matchedKeyword).toBe("Passwort");
  });

  it("finds a section by its title, without naming a keyword", () => {
    const [hit] = searchSettings("einheit", candidates);
    expect(hit).toMatchObject({ section: "units", matchedKeyword: null });
  });

  it("ignores case, accents and ß", () => {
    expect(searchSettings("WAHRUNG", candidates)[0].section).toBe("units");
    expect(searchSettings("strassen", candidates)[0].section).toBe("externalServices");
  });

  it("puts a title hit before a keyword hit", () => {
    const withTitle: SettingsSearchCandidate[] = [
      ...candidates,
      {
        section: "about",
        label: "Routing-Hilfe",
        groupLabel: "Daten",
        href: "/settings/account",
        keywords: [],
      },
    ];
    expect(searchSettings("routing", withTitle).map((h) => h.section)).toEqual([
      "about",
      "externalServices",
    ]);
  });

  it("finds nothing for one letter or for a word no section carries", () => {
    expect(searchSettings("e", candidates)).toEqual([]);
    expect(searchSettings("quantenphysik", candidates)).toEqual([]);
  });

  it("splits a translated keyword list on commas", () => {
    expect(splitKeywords(" Passwort,  2FA ,,Passkey ")).toEqual(["Passwort", "2FA", "Passkey"]);
    expect(foldForSearch(" Größe ")).toBe("grosse");
  });
});

describe("settings search — expert rows (forgejo#321)", () => {
  const services: SettingsSearchCandidate = {
    section: "externalServices",
    label: "Meine externen Dienste",
    groupLabel: "Dienste",
    href: "/settings/services?section=externalServices",
    keywords: ["AirLabs", "Immich"],
    expertKeywords: ["eigener API-Schlüssel", "AirLabs-Schlüssel"],
  };

  it("classifies a hit as expert when it reaches a hidden row, whatever else matched", () => {
    // "airlabs" is both a provider (shown at standard) and a key form (expert).
    const [hit] = searchSettings("airlabs", [services]);
    expect(hit.expertOnly).toBe(true);
  });

  it("stays standard when only the standard words match", () => {
    const [hit] = searchSettings("immich", [services]);
    expect(hit.expertOnly).toBe(false);
  });
});

describe("settings search — the shipped keyword lists", () => {
  // An ordinary keyword must not repeat an expert one: with the same word in
  // both, a reader at the standard level could not tell the hit apart.
  it.each([
    ["de", "settings"],
    ["en", "settings"],
    ["de", "admin"],
    ["en", "admin"],
  ])("keeps the %s %s ordinary and expert words apart", async (lang, ns) => {
    const { default: copy } = await import(`../../i18n/resources/${lang}/${ns}.json`);
    const { keywords, expertKeywords } = copy.search as {
      keywords: Record<string, string>;
      expertKeywords: Record<string, string>;
    };
    for (const [section, expert] of Object.entries(expertKeywords)) {
      const ordinary = new Set(splitKeywords(keywords[section] ?? "").map(foldForSearch));
      const shared = splitKeywords(expert).filter((k) => ordinary.has(foldForSearch(k)));
      expect(shared, `${lang} ${section}`).toEqual([]);
    }
  });
});
