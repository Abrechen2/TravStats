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
    route: "account",
    keywords: ["Passwort", "Passkey", "Zwei-Faktor", "2FA"],
  },
  {
    section: "units",
    label: "Einheiten & Formate",
    groupLabel: "Darstellung",
    route: "account",
    keywords: ["Kilometer", "Meilen", "Währung", "Datumsformat"],
  },
  {
    section: "externalServices",
    label: "Meine externen Dienste",
    groupLabel: "Dienste",
    route: "account",
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
        route: "account",
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
