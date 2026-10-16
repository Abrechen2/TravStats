import { describe, expect, it } from "vitest";
import { createInstance } from "i18next";
import deBus from "../resources/de/bus.json";
import enBus from "../resources/en/bus.json";
import deEncryptedShare from "../resources/de/encryptedShare.json";
import enEncryptedShare from "../resources/en/encryptedShare.json";
import deLodging from "../resources/de/lodging.json";
import enLodging from "../resources/en/lodging.json";
import dePlaces from "../resources/de/places.json";
import enPlaces from "../resources/en/places.json";
import deSharing from "../resources/de/sharing.json";
import enSharing from "../resources/en/sharing.json";
import deStats from "../resources/de/stats.json";
import enStats from "../resources/en/stats.json";

/**
 * Each of these strings is called with `count`, but was a single plural form,
 * so one item read "1 Fahrten sind noch offen", "Aus 1 Flügen", "1 Dateien",
 * "1 bestehende Aufenthalte aktualisiert". Resolved through a real i18next
 * instance, because the `_one` / `_other` pick is the library's.
 */
const instance = createInstance();
void instance.init({
  lng: "de",
  fallbackLng: false,
  resources: {
    de: {
      bus: deBus,
      encryptedShare: deEncryptedShare,
      lodging: deLodging,
      places: dePlaces,
      sharing: deSharing,
      stats: deStats,
    },
    en: {
      bus: enBus,
      encryptedShare: enEncryptedShare,
      lodging: enLodging,
      places: enPlaces,
      sharing: enSharing,
      stats: enStats,
    },
  },
});

const say = (lng: "de" | "en", key: string, count: number): string =>
  instance.getFixedT(lng)(key, { count, name: "N" });

/** [key, DE one, EN one, DE other (count 3), EN other] */
const CASES: readonly [string, string, string, string, string][] = [
  [
    "bus:routing.all.remaining",
    "1 Fahrt ist noch offen; starte die Berechnung erneut.",
    "1 ride is still open; run the routing again.",
    "3 Fahrten sind noch offen; starte die Berechnung erneut.",
    "3 rides are still open; run the routing again.",
  ],
  [
    "encryptedShare:tripCount",
    "1 Reise für Detailzugriff",
    "1 trip available for detail access",
    "3 Reisen für Detailzugriff",
    "3 trips available for detail access",
  ],
  ["encryptedShare:e2e.files", "1 Datei", "1 file", "3 Dateien", "3 files"],
  [
    "encryptedShare:entryCount",
    "1 Eintrag auf dieser Seite",
    "1 entry on this page",
    "3 Einträge auf dieser Seite",
    "3 entries on this page",
  ],
  [
    "stats:punctuality.subtitle",
    "Aus 1 Flug mit erfasster Verspätung.",
    "From 1 flight with a recorded delay.",
    "Aus 3 Flügen mit erfasster Verspätung.",
    "From 3 flights with a recorded delay.",
  ],
  [
    "places:lists.deleteMessage",
    "„N“ wird gelöscht. Der eine Ort darin bleibt in deinem Logbuch — nur die Gruppierung verschwindet.",
    "“N” will be deleted. The one place in it stays in your logbook — only the grouping goes.",
    "„N“ wird gelöscht. Die 3 Orte darin bleiben in deinem Logbuch — nur die Gruppierung verschwindet.",
    "“N” will be deleted. The 3 places in it stay in your logbook — only the grouping goes.",
  ],
  ["sharing:values.list", "1 Eintrag", "1 entry", "3 Einträge", "3 entries"],
  [
    "lodging:import.commitResult.updatedSuffix",
    " 1 bestehender Aufenthalt aktualisiert.",
    " 1 stored stay updated.",
    " 3 bestehende Aufenthalte aktualisiert.",
    " 3 stored stays updated.",
  ],
];

describe("counted copy agrees with its count", () => {
  it.each(CASES)("%s", (key, deOne, enOne, deOther, enOther) => {
    expect(say("de", key, 1)).toBe(deOne);
    expect(say("en", key, 1)).toBe(enOne);
    expect(say("de", key, 3)).toBe(deOther);
    expect(say("en", key, 3)).toBe(enOther);
  });
});
