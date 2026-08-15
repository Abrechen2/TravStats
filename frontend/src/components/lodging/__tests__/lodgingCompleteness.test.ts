import { describe, it, expect } from "vitest";
import { lodgingIssue } from "../lodgingCompleteness";
import type { Lodging } from "../../../types/lodging";

/** Nur die Felder, über die dieser Zustand entscheidet — der Rest ist Beiwerk. */
function haus(teile: Partial<Lodging>): Lodging {
  return {
    id: "x", userId: "u", type: "hotel", name: "Haus", chainId: null, chain: null,
    address: "Hauptstr. 1", city: "Köln", country: "Deutschland", lat: 50.9, lon: 6.9,
    stars: null, amenities: [], notes: null, dataSource: null,
    createdAt: "", updatedAt: "", stays: [], overallRating: null, stayCount: 0, nights: 0,
    ...teile,
  } as Lodging;
}

describe("lodgingIssue", () => {
  it("meldet nichts, wenn die Zeile vollständig ist", () => {
    expect(lodgingIssue(haus({}))).toBeNull();
  });

  it("Adresse ohne Punkt: nicht gefunden — der häufigste Fall (20 von 291)", () => {
    expect(lodgingIssue(haus({ lat: null, lon: null }))).toBe("unlocated");
  });

  it("ein halbes Koordinatenpaar ist kein Ort", () => {
    // lat und lon sind unabhängig nullbar. Nur eine Hälfte ergibt keinen Punkt,
    // sondern einen Eintrag am Nullmeridian — die Zeile gilt als unverortet.
    expect(lodgingIssue(haus({ lon: null }))).toBe("unlocated");
    expect(lodgingIssue(haus({ lat: null }))).toBe("unlocated");
  });

  it("kein Punkt UND keine Adresse, aber ein Ort: es fehlt die Adresse", () => {
    // Nicht „nicht gefunden": es gibt nichts zu finden. Das eine ist ein
    // erneuter Versuch, das andere Handarbeit.
    expect(lodgingIssue(haus({ address: null, lat: null, lon: null }))).toBe("noAddress");
  });

  it("nur ein Name: das ist die schwerste Lücke und gewinnt", () => {
    expect(
      lodgingIssue(haus({ address: null, city: null, lat: null, lon: null }))
    ).toBe("bare");
  });

  it("Leerzeichen sind kein Inhalt", () => {
    expect(lodgingIssue(haus({ address: "   ", lat: null, lon: null }))).toBe("noAddress");
  });

  it("ein Land, das keines ist, wird benannt", () => {
    // Echter Fund: „Fohnsdorf" — ein Ort in der Steiermark, den ein Export in
    // die Länderspalte geschrieben hat. Ohne Hinweis sieht der Nutzer nur eine
    // fehlende Flagge und kann nicht unterscheiden, ob sie fehlt oder der Wert
    // falsch ist.
    expect(lodgingIssue(haus({ country: "Fohnsdorf" }))).toBe("unknownCountry");
  });

  it("ein Land in seiner eigenen Sprache ist KEIN Fehler", () => {
    // Der Resolver versteht jede Sprache. Diese Zeilen dürfen nicht als
    // fehlerhaft markiert werden, nur weil die App zweisprachig ist.
    for (const land of ["Việt Nam", "Hrvatska", "Madagasikara / Madagascar", "España"]) {
      expect(lodgingIssue(haus({ country: land }))).toBeNull();
    }
  });

  it("eine vollständige Zeile ohne Land bleibt unauffällig", () => {
    // Ein leeres Länderfeld ist eine Lücke, aber keine, die eine eigene Warnung
    // verdient — die Karte und die Adresse tragen die Zeile trotzdem.
    expect(lodgingIssue(haus({ country: null }))).toBeNull();
  });
});
