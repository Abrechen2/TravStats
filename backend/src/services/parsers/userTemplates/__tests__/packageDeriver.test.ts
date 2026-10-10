import { describe, it, expect } from "@jest/globals";
import { derivePackageTemplate } from "../packageDeriver";
import { parsePackageText } from "../../../trip/package/parsePackage";
import { workshopEnvelopeSchema } from "../../templates/v2/envelope";
import { previewTemplate } from "../preview";
import type { UserTemplate } from "../types";
import { select } from "./workshopSamples";
import {
  PACKAGE_FOREIGN,
  PACKAGE_HELD_OUT,
  PACKAGE_SELECTIONS,
  PACKAGE_SOURCE,
  PACKAGE_SUBJECT,
} from "./packageSamples";

/**
 * forgejo#124 — the workshop derives a package template: booking fields from
 * label patterns, the flight and hotel lists from ONE marked row each. Run
 * through the reader and contract the parse uses, never a test double.
 */
const input = {
  trainingDataId: "td-package-1",
  subject: PACKAGE_SUBJECT,
  fullText: PACKAGE_SOURCE,
  selections: PACKAGE_SELECTIONS,
};

function derived() {
  const result = derivePackageTemplate(input);
  if (!result.ok) throw new Error(`derivation refused: ${result.refusal}`);
  return result.template;
}

const read = (text: string, subject = PACKAGE_SUBJECT) =>
  parsePackageText(`${subject}\n${text}`, [derived()]);

const without = (...labels: string[]) =>
  PACKAGE_SELECTIONS.filter((s) => !labels.includes(s.label));

describe("derivePackageTemplate", () => {
  it("writes a package workshop envelope the shared schema accepts", () => {
    const t = derived();
    expect(workshopEnvelopeSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({ id: "package:user-td-package-1", domain: "package" });
    expect(t.issuer.kind).toBe("tour-operator");
  });

  it("reads its own sample: the booking, every flight and the hotel", () => {
    const { reading } = read(PACKAGE_SOURCE);
    expect(reading).toMatchObject({
      bookingReference: "SF-204417",
      issuedOn: "2027-05-12",
      tripName: "Rundreise Probeland",
    });
    expect(reading?.flights).toEqual([
      expect.objectContaining({
        flightNumber: "XQ1234",
        date: "2027-07-01",
        depIata: "HAM",
        arrIata: "AYT",
        depTime: "06:10",
        arrTime: "10:40",
      }),
      expect.objectContaining({ flightNumber: "XQ1235", date: "2027-07-08", depIata: "AYT" }),
    ]);
    expect(reading?.stays).toEqual([
      expect.objectContaining({
        name: "Hotel Probebucht",
        city: "Antalya",
        checkIn: "2027-07-01",
        checkOut: "2027-07-08",
      }),
    ]);
  });

  it("reads the same operator's next booking it never saw", () => {
    const { reading } = read(PACKAGE_HELD_OUT);
    expect(reading?.bookingReference).toBe("SF-219930");
    expect(reading?.flights.map((f) => `${f.depIata}-${f.arrIata}`)).toEqual([
      "MUC-HER",
      "HER-RHO",
      "RHO-MUC",
    ]);
    expect(reading?.stays.map((s) => s.name)).toEqual(["Hotel Kretablick", "Villa Probehafen"]);
  });

  it("declines another operator's document", () => {
    expect(read(PACKAGE_FOREIGN, "Buchung – Wolkenweit Touristik").reading).toBeNull();
  });

  it("refuses without the booking fields the contract requires", () => {
    expect(derivePackageTemplate({ ...input, selections: without("issuedOn") })).toEqual({
      ok: false,
      refusal: "packageNeedsBookingFields",
    });
  });

  it("refuses without a single row, and with an incomplete one", () => {
    const rows = PACKAGE_SELECTIONS.filter((s) => /^(flight|stay)/.test(s.label)).map(
      (s) => s.label
    );
    expect(derivePackageTemplate({ ...input, selections: without(...rows) })).toEqual({
      ok: false,
      refusal: "packageNeedsRow",
    });
    expect(derivePackageTemplate({ ...input, selections: without("flightArrIata") })).toEqual({
      ok: false,
      refusal: "packageFlightRowIncomplete",
    });
    expect(derivePackageTemplate({ ...input, selections: without("stayCheckOut") })).toEqual({
      ok: false,
      refusal: "packageStayRowIncomplete",
    });
  });

  it("refuses a row whose marks lie on lines with other lines between", () => {
    const selections = [
      ...without("stayCheckOut"),
      // The check-out marked in the trip span far above the hotel row.
      select(PACKAGE_SOURCE, "08.07.2027", "stayCheckOut", 1),
    ];
    expect(derivePackageTemplate({ ...input, selections })).toEqual({
      ok: false,
      refusal: "packageRowTooFarApart",
    });
  });

  it("previews what a parse would read, before anything is activated", () => {
    const template = {
      id: "t1",
      name: "Sonnenfern",
      fingerprint: { senderDomains: [], subjectPatterns: [], bodyMarkers: [] },
      patterns: derived(),
    } as unknown as UserTemplate;
    const preview = previewTemplate("package", template, PACKAGE_SUBJECT, PACKAGE_HELD_OUT);
    expect(preview.matched).toBe(true);
    expect(preview.fields).toEqual(
      expect.arrayContaining([
        { name: "bookingReference", value: "SF-219930" },
        expect.objectContaining({ name: "flights" }),
      ])
    );
    expect(previewTemplate("package", template, "x", PACKAGE_FOREIGN).matched).toBe(false);
  });
});
