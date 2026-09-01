import { backfillRoutesFromText, parenthesisedCodes } from "../routeFromText";

/**
 * The SHAPE of an Air France confirmation, not one of the archived mails:
 * those are a third party's and stay out of the repository. What matters here
 * is reproduced exactly — the airport name with its code in brackets behind it,
 * one bracketed pair per leg, in itinerary order.
 */
const FOUR_LEG_CONFIRMATION = [
  "Dienstag 11 Februar 2014",
  "AF1423 - Economy \t09:55\t München, München (MUC), DEUTSCHLAND -  Terminal 1",
  "Meldeschlusszeit : 09:15",
  "11:35\t Paris, Charles de Gaulle (CDG),  FRANKREICH",
  "AF7724 - Economy \t12:45\t Paris, Charles de Gaulle (CDG), FRANKREICH -  Terminal 2F",
  "13:50\t Nantes, Atlantique (NTE),  FRANKREICH",
  "Donnerstag 13 Februar 2014",
  "AF7725 - Economy \t11:20\t Nantes, Atlantique (NTE), FRANKREICH -  Terminal",
  "12:25\t Paris, Charles de Gaulle (CDG),  FRANKREICH",
  "AF1622 - Economy \t13:10\t Paris, Charles de Gaulle (CDG), FRANKREICH -  Terminal 2F",
  "14:40\t München, München (MUC),  DEUTSCHLAND",
].join("\n");

/** A promotion of the kind that produced three phantom flights in #35. */
const MARKETING_MAIL = [
  "Nur 7 Tage gültig: Ihr 30 EUR Oster-Geschenk",
  "Jetzt buchen und sparen! Die schönsten Ziele der Welt warten auf Sie.",
  "Emirates-Flüge ab 380 EUR. Angebot gültig bis Ostern.",
].join("\n");

const routeless = (n: number) => Array.from({ length: n }, () => ({ flightNumber: "AF1423" }));

describe("parenthesisedCodes", () => {
  it("reads the codes in itinerary order, duplicates kept", () => {
    expect(parenthesisedCodes(FOUR_LEG_CONFIRMATION)).toEqual([
      "MUC",
      "CDG",
      "CDG",
      "NTE",
      "NTE",
      "CDG",
      "CDG",
      "MUC",
    ]);
  });

  it("does not read an ordinary lowercase word in brackets as a code", () => {
    expect(parenthesisedCodes("ein Hinweis (die) und noch einer (der)")).toEqual([]);
  });
});

describe("backfillRoutesFromText", () => {
  it("pairs each leg with the codes printed for it", () => {
    expect(backfillRoutesFromText(routeless(4), FOUR_LEG_CONFIRMATION)).toEqual([
      { flightNumber: "AF1423", departureCode: "MUC", arrivalCode: "CDG" },
      { flightNumber: "AF1423", departureCode: "CDG", arrivalCode: "NTE" },
      { flightNumber: "AF1423", departureCode: "NTE", arrivalCode: "CDG" },
      { flightNumber: "AF1423", departureCode: "CDG", arrivalCode: "MUC" },
    ]);
  });

  it("recovers NTE, which the hand-kept COMMON_VALID_IATA_CODES set omits", () => {
    // The whole reason the bracket rule is structural rather than a whitelist
    // lookup: a strict validator drops Nantes, the leg #35 actually reported.
    const legs = backfillRoutesFromText(routeless(4), FOUR_LEG_CONFIRMATION);
    expect(legs.map((l) => l.arrivalCode)).toContain("NTE");
  });

  it("invents nothing from a marketing mail", () => {
    expect(backfillRoutesFromText(routeless(3), MARKETING_MAIL)).toEqual(routeless(3));
  });

  it("leaves the route null rather than guess when the codes do not pair up", () => {
    // Three flights need six codes; the document prints eight.
    expect(backfillRoutesFromText(routeless(3), FOUR_LEG_CONFIRMATION)).toEqual(routeless(3));
  });

  it("never overwrites a route the provider already got right", () => {
    const parsed = [{ departureCode: "TXL", arrivalCode: "LHR" }, { flightNumber: "AF1" }];
    expect(backfillRoutesFromText(parsed, FOUR_LEG_CONFIRMATION)).toEqual(parsed);
  });
});
