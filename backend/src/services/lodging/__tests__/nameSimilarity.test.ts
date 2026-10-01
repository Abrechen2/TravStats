import { describe, it, expect } from "@jest/globals";
import {
  namesCouldBeOneHouse,
  significantTokens,
  sharedSignificantTokens,
} from "../nameSimilarity";

/**
 * Every pair below is real, from the owner's own library, where one house was
 * imported twice because the matcher keys on the whole name: a booking mail
 * writes it one way, a saved-places export another.
 *
 * The case that set the shape of this module was created live on 2026-08-16:
 *
 *   "Emirates Palace Mandarin Oriental"  saved-places, Abu Dhabi, pinned
 *   "Emirates Palace, Abu Dhabi"         booking mail, no pin, city "F869C3J"
 *
 * Neither name contains the other, so a containment rule misses it. What they
 * share is two distinctive words. That — not containment — is the signal.
 */

describe("significantTokens", () => {
  it("drops the words that decorate every hotel name", () => {
    expect(significantTokens("Hotel - Restaurant Fortuna")).toEqual(["fortuna"]);
    expect(significantTokens("Landgasthof Adler")).toEqual(["adler"]);
    expect(significantTokens("Hotel & Restaurant Rose")).toEqual(["rose"]);
  });

  it("drops company suffixes, which a booking mail never prints", () => {
    expect(
      significantTokens("Kiekenstein Hotel-Restaurant, Inh. Strathmann GmbH & Co. KG")
    ).toEqual(["kiekenstein", "strathmann"]);
  });

  it("folds umlauts and case so two spellings meet", () => {
    expect(significantTokens("Nordhäuser Fürstenhof")).toEqual(["nordhaeuser", "fuerstenhof"]);
    expect(significantTokens("NORDHAEUSER FUERSTENHOF")).toEqual(["nordhaeuser", "fuerstenhof"]);
  });

  it("keeps a name that is nothing but decoration", () => {
    // Stripping it to nothing would let it match every hotel on earth.
    expect(significantTokens("Hotel")).toEqual(["hotel"]);
  });
});

describe("sharedSignificantTokens", () => {
  it("finds the two words the live duplicate had in common", () => {
    expect(
      sharedSignificantTokens("Emirates Palace Mandarin Oriental", "Emirates Palace, Abu Dhabi")
    ).toEqual(["emirates", "palace"]);
  });

  it("sees through decoration on the real pairs", () => {
    expect(sharedSignificantTokens("NH Ludwigsburg", "Hotel NH Ludwigsburg")).toEqual([
      "nh",
      "ludwigsburg",
    ]);
    expect(sharedSignificantTokens("Hotel Fortuna", "Hotel - Restaurant Fortuna")).toEqual([
      "fortuna",
    ]);
    expect(sharedSignificantTokens("Super 8 Freiburg", "Super 8 by Wyndham Freiburg")).toEqual([
      "super",
      "8",
      "freiburg",
    ]);
  });

  it("is symmetric — which side came from the mail must not matter", () => {
    expect(sharedSignificantTokens("Hotel NH Ludwigsburg", "NH Ludwigsburg")).toEqual(
      sharedSignificantTokens("NH Ludwigsburg", "Hotel NH Ludwigsburg")
    );
  });

  it("reports the overlap of two different houses honestly", () => {
    // One shared word. The CALLER decides that one is not enough — this
    // function counts, it does not judge.
    expect(
      sharedSignificantTokens("Park Inn Berlin Alexanderplatz", "Park Inn Frankfurt Flughafen")
    ).toEqual(["park", "inn"]);
    expect(sharedSignificantTokens("Hotel Fortuna", "Hotel Adler")).toEqual([]);
  });

  it("does not let decoration alone create an overlap", () => {
    // Both are nothing but generic words; joining them would fold every
    // "Hotel Restaurant" in the catalogue into one house.
    expect(sharedSignificantTokens("Hotel Restaurant", "Restaurant Hotel")).toEqual([]);
  });
});

// forgejo#84 — the decision the header promised the caller would make.
describe("namesCouldBeOneHouse", () => {
  it("never folds two houses in different towns, whatever the names share", () => {
    expect(namesCouldBeOneHouse("Hotel Rose", "Hotel Rose", false)).toBe(false);
  });

  it("takes one shared identifying word as a guess when the town agrees", () => {
    expect(namesCouldBeOneHouse("Hotel Meteora", "Hotel Restaurant Meteora", true)).toBe(true);
    expect(namesCouldBeOneHouse("Hotel Post", "Gasthof Krone", true)).toBe(false);
  });

  it("needs two identifying words, or full containment, when the town is unknown", () => {
    expect(
      namesCouldBeOneHouse("Emirates Palace, Abu Dhabi", "Emirates Palace Mandarin Oriental", null)
    ).toBe(true);
    expect(namesCouldBeOneHouse("Krafft Basel", "Hotel Krafft Basel", null)).toBe(true);
    expect(
      namesCouldBeOneHouse(
        "Corpus Christi KOA Journey",
        "Rockport / Corpus Christi KOA Journey",
        null
      )
    ).toBe(true);
    expect(namesCouldBeOneHouse("Hotel Meteora", "Hotel Restaurant Meteora", null)).toBe(false);
    expect(namesCouldBeOneHouse("Hotel Post", "Hotel Post Garni", null)).toBe(false);
  });
});

describe("a place, a decoration or a brand is not identity", () => {
  // Prod, 2026-09-30: an ALL Accor booking for Novotel Basel City became a
  // stay at Hotel Krafft Basel. The one shared word was the city itself.
  it("does not match two hotels whose only shared word is their city", () => {
    expect(
      namesCouldBeOneHouse("Novotel Basel City", "Hotel Krafft Basel", true, {
        places: ["Basel", "Basel"],
      })
    ).toBe(false);
  });

  it("does not match two hotels of one brand in one city by name", () => {
    expect(
      namesCouldBeOneHouse("Novotel Basel City", "Novotel Basel SBB", true, {
        places: ["Basel", "Basel"],
      })
    ).toBe(false);
  });

  it("does not match on location decoration alone", () => {
    expect(
      namesCouldBeOneHouse("Mercure Zentrum", "Hotel Zentrum", true, { places: ["Zürich"] })
    ).toBe(false);
  });

  it("still matches a decorated name of one house (forgejo#84)", () => {
    expect(
      namesCouldBeOneHouse("Hotel Meteora", "Hotel Restaurant Meteora", true, {
        places: ["Kalambaka", "Kalambaka"],
      })
    ).toBe(true);
  });

  it("still matches two identifying words with no city known", () => {
    expect(namesCouldBeOneHouse("Emirates Palace", "Emirates Palace Mandarin Oriental", null)).toBe(
      true
    );
  });

  it("matches a name to itself even when every word is brand or place", () => {
    expect(
      namesCouldBeOneHouse("Novotel Basel City", "novotel basel city", true, {
        places: ["Basel", "Basel"],
      })
    ).toBe(true);
  });

  it("does not match the same name in a different city", () => {
    expect(namesCouldBeOneHouse("Novotel City", "Novotel City", false)).toBe(false);
  });

  it("lets pins decide: nearby, a brand and a place count as before", () => {
    // The OSM enrichment searches around the hotel's own coordinates, so the
    // place is already proven; its own OSM object must still be found.
    expect(
      namesCouldBeOneHouse("Novotel Basel City", "Novotel / ibis Budget Basel City", true, {
        nearby: true,
      })
    ).toBe(true);
  });
});
