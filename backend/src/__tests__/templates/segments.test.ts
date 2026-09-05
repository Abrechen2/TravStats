import fs from "fs";
import path from "path";
import {
  applyArrivalDayOffset,
  applyTemplateAll,
  splitSegments,
} from "../../services/parsers/templates/engine";
import type { AirlineTemplate } from "../../services/parsers/templates/types";
import { TemplateParser } from "../../services/parsers/text/templateParser";
import { templateRegistry } from "../../services/parsers/templates/registry";

/**
 * A synthetic Lufthansa "Buchungsdetails" mail in the shape the real ones
 * have (measured on the owner's corpus, 2026-09-05): a header with the
 * booking code, then one block per leg headed by a weekday date. Airports,
 * numbers and the code are invented; the layout is not.
 */
const LH_OLD_MAIL = [
  "Buchungsdetails",
  "Buchungscode:",
  "QX7PLM",
  "Passagierinformationen",
  "Ticketnummer: 2201234567890",
  "Reiseverlauf",
  "Do. 23. November 2023: München – Frankfurt/Main",
  "09:00 Uhr \tMünchen Munich (MUC)",
  "Terminal 2",
  "10:05 Uhr \tFrankfurt/Main Frankfurt (FRA)",
  "Terminal 1",
  " \tLH 99",
  "durchgeführt von:",
  "Lufthansa",
  "Status: bestätigt",
  "Sitzplätze: 26F*",
  "Klasse: Economy Class (K)",
  "Do. 23. November 2023: Frankfurt/Main – Las Vegas",
  "Wichtige Hinweise",
  " \tAufgrund von verstärkten Sicherheitskontrollen bei Flügen in die USA wird empfohlen, früher da zu sein.",
  "11:05 Uhr \tFrankfurt/Main Frankfurt (FRA)",
  "Terminal 1",
  "13:50 Uhr \tLas Vegas McCarran Intl (LAS)",
  "Terminal 3",
  " \tLH 4352",
  "durchgeführt von:",
  "Eurowings Discover",
  "Status: bestätigt",
  "Klasse: Premium Economy (N)",
  "Do. 30. November 2023: Los Angeles – München",
  "17:30 Uhr \tLos Angeles Los Angeles Intl (LAX)",
  "Terminal B",
  "13:40 Uhr +1 \tMünchen Munich (MUC)",
  "Terminal 2",
  " \tLH 453",
  "durchgeführt von:",
  "Lufthansa",
  "Status: bestätigt",
  "Klasse: Premium Economy (R)",
  "Flugpreis",
  "Weitere Angebote ab Berlin (BER) finden Sie auf lufthansa.com",
].join("\n");

function lhOld(): AirlineTemplate {
  const raw = fs.readFileSync(
    path.join(__dirname, "../../services/parsers/templates/airlines/LH-old.json"),
    "utf8"
  );
  return JSON.parse(raw) as AirlineTemplate;
}

describe("template segments — one booking per leg", () => {
  it("splits a Buchungsdetails mail at every weekday-date heading, keeping the header", () => {
    const split = splitSegments(lhOld(), LH_OLD_MAIL);
    expect(split).not.toBeNull();
    expect(split!.blocks).toHaveLength(3);
    expect(split!.header).toMatch(/QX7PLM/);
    expect(split!.blocks[0]).toMatch(/^Do\. 23\. November 2023: München/);
    expect(split!.blocks[2]).toMatch(/Los Angeles – München/);
  });

  it("returns null for a template without segments or a mail with a single leg", () => {
    const single = LH_OLD_MAIL.split("\n").slice(0, 17).join("\n");
    expect(splitSegments(lhOld(), single)).toBeNull();
    expect(splitSegments({ ...lhOld(), segments: undefined }, LH_OLD_MAIL)).toBeNull();
  });

  it("reads all three legs with numbers, codes, dates and the shared booking code", () => {
    const legs = applyTemplateAll(lhOld(), LH_OLD_MAIL, "");
    expect(legs.map((l) => l.flightNumber)).toEqual(["LH99", "LH4352", "LH453"]);
    expect(legs.map((l) => `${l.departureCode}-${l.arrivalCode}`)).toEqual([
      "MUC-FRA",
      "FRA-LAS",
      "LAX-MUC",
    ]);
    expect(legs.map((l) => l.departureTime)).toEqual([
      "2023-11-23T09:00",
      "2023-11-23T11:05",
      "2023-11-30T17:30",
    ]);
    for (const leg of legs) expect(leg.pnr).toBe("QX7PLM");
    // The footer's "(BER)" never becomes anybody's arrival.
    expect(legs.some((l) => l.arrivalCode === "BER")).toBe(false);
  });

  it("moves an arrival marked '+1' to the next day", () => {
    const legs = applyTemplateAll(lhOld(), LH_OLD_MAIL, "");
    expect(legs[2].arrivalTime).toBe("2023-12-01T13:40");
    expect(legs[0].arrivalTime).toBe("2023-11-23T10:05");
  });

  it("applyArrivalDayOffset leaves a booking alone when no '+N' names its arrival clock", () => {
    const booking = { arrivalTime: "2023-11-23T10:05", missing: [] };
    expect(
      applyArrivalDayOffset(booking, "10:05 Uhr \tFrankfurt (FRA)\n13:40 Uhr +1 \tMünchen")
    ).toEqual(booking);
  });

  it("the TemplateParser hands every leg on, each with the airline notice", async () => {
    await templateRegistry.initialize();
    const parsed = await new TemplateParser().parseEmail("Buchungsdetails", LH_OLD_MAIL, undefined);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].parserTemplate).toBe("LH-old");
    expect(new Set(parsed.map((p) => p.airlineNotice)).size).toBe(1);
  });
});

/**
 * The 2025 "Vielen Dank für Ihre Buchung" layout, in both spellings the
 * corpus holds (2026-09-05). The "Reiseplan" further down repeats every
 * leg's date line — the fence is what keeps those from becoming legs of
 * their own. Numbers, codes and dates are invented.
 */
const LH_NEW_COMPACT = [
  "Ihre Reise nach Osaka: Alle Details zur Buchung",
  "Buchungscode: K7QZ2R",
  "Buchungsübersicht",
  "23.05.2025 - 12:25",
  "LH742",
  "MUC KIX",
  "München Osaka",
  "06.06.2025 - 09:30",
  "LH715",
  "HND MUC",
  "Tokio München",
  "Buchung verwalten",
  "Reiseplan",
  "23.05.2025 - 12:25",
  "München",
  "Bestätigt",
  "24.05.2025 - 07:15",
  "Osaka",
  "LH742 Durchgeführt von: Lufthansa",
].join("\n");

const LH_NEW_LABELLED = [
  "Buchungscode: 9RFAA7",
  "Buchungsübersicht",
  "18.09.2025 - 08:25",
  "Datum der Abreise 18.09.2025 Abflugzeit 08:25",
  "LH2460",
  "Flugnummer LH2460",
  "MUC",
  "IATA-Code des Abflughafens MUC",
  "HEL",
  "IATA-Code des Ankunftsflughafens HEL",
  "21.09.2025 - 19:40",
  "Datum der Abreise 21.09.2025 Abflugzeit 19:40",
  "LH2465",
  "Flugnummer LH2465",
  "HEL",
  "IATA-Code des Abflughafens HEL",
  "MUC",
  "IATA-Code des Ankunftsflughafens MUC",
  "Buchung verwalten",
  "Reiseplan",
  "18.09.2025 - 08:25",
  "München",
].join("\n");

function lhNew(): AirlineTemplate {
  const raw = fs.readFileSync(
    path.join(__dirname, "../../services/parsers/templates/airlines/LH.json"),
    "utf8"
  );
  return JSON.parse(raw) as AirlineTemplate;
}

describe("template segments — fenced region (Lufthansa 2025 layout)", () => {
  it("reads the compact block spelling: two legs, not five, none of them from the Reiseplan", () => {
    const legs = applyTemplateAll(lhNew(), LH_NEW_COMPACT, "");
    expect(legs).toHaveLength(2);
    expect(
      legs.map((l) => [l.flightNumber, l.departureCode, l.arrivalCode, l.departureTime])
    ).toEqual([
      ["LH742", "MUC", "KIX", "2025-05-23T12:25"],
      ["LH715", "HND", "MUC", "2025-06-06T09:30"],
    ]);
    for (const leg of legs) expect(leg.pnr).toBe("K7QZ2R");
  });

  it("reads the labelled block spelling the same way", () => {
    const legs = applyTemplateAll(lhNew(), LH_NEW_LABELLED, "");
    expect(
      legs.map((l) => [l.flightNumber, l.departureCode, l.arrivalCode, l.departureTime])
    ).toEqual([
      ["LH2460", "MUC", "HEL", "2025-09-18T08:25"],
      ["LH2465", "HEL", "MUC", "2025-09-21T19:40"],
    ]);
  });

  it("a fence marker that does not occur widens the region instead of emptying it", () => {
    const noHeading = LH_NEW_COMPACT.replace("Buchungsübersicht\n", "");
    const split = splitSegments(lhNew(), noHeading);
    expect(split).not.toBeNull();
    // Still fenced at the end, so the Reiseplan repeat is not a leg.
    expect(split!.blocks).toHaveLength(2);
  });
});
