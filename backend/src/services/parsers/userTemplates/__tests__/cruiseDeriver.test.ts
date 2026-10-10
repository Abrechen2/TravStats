import { describe, it, expect } from "@jest/globals";
import { deriveCruiseTemplate } from "../cruiseDeriver";
import { applyV2CruiseTemplate } from "../../../cruise/v2Cruise";
import { validateEnvelope, workshopEnvelopeSchema } from "../../templates/v2/envelope";
import {
  CRUISE_FOREIGN,
  CRUISE_HELD_OUT,
  CRUISE_SELECTIONS,
  CRUISE_SOURCE,
  CRUISE_SUBJECT,
  select,
} from "./workshopSamples";

/**
 * forgejo#124 — the workshop derives a cruise template: header fields from
 * label patterns, the port list from ONE marked itinerary row. Run through the
 * consumer the parser uses (`applyV2CruiseTemplate`), never a test double.
 */

const input = {
  trainingDataId: "td-cruise-1",
  subject: CRUISE_SUBJECT,
  fullText: CRUISE_SOURCE,
  selections: CRUISE_SELECTIONS,
};

function derived() {
  const result = deriveCruiseTemplate(input);
  if (!result.ok) throw new Error(`derivation refused: ${result.refusal}`);
  return result.template;
}

const read = (text: string, subject = CRUISE_SUBJECT) =>
  applyV2CruiseTemplate(derived(), `${subject}\n${text}`);

describe("deriveCruiseTemplate", () => {
  it("writes a workshop envelope the shared schema accepts, with no test cases", () => {
    const template = derived();
    expect(workshopEnvelopeSchema.safeParse(template).success).toBe(true);
    expect(template.id).toBe("cruise:user-td-cruise-1");
    expect(template.domain).toBe("cruise");
    // A repository template needs a suite; a workshop one has the preview.
    expect(validateEnvelope(template).ok).toBe(false);
  });

  it("reads its own sample: header values and every stop, with the sea day", () => {
    const [cruise] = read(CRUISE_SOURCE);
    expect(cruise).toMatchObject({
      shipName: "MS Probestern",
      bookingReference: "NL-48213",
      cabinNumber: "7042",
      cabinType: "balcony",
      price: 2480,
      startDate: "2027-06-02",
      endDate: "2027-06-05",
      departurePortName: "Kiel",
      arrivalPortName: "Kiel",
    });
    expect(cruise.stops).toEqual([
      { dayNumber: 1, date: "2027-06-02", isAtSea: false, portName: "Kiel" },
      { dayNumber: 2, date: "2027-06-03", isAtSea: true },
      { dayNumber: 3, date: "2027-06-04", isAtSea: false, portName: "Oslo" },
      { dayNumber: 4, date: "2027-06-05", isAtSea: false, portName: "Kiel" },
    ]);
  });

  it("reads a held-out confirmation of the same line it never saw", () => {
    const cruises = read(CRUISE_HELD_OUT);
    expect(cruises).toHaveLength(1);
    expect(cruises[0]).toMatchObject({
      shipName: "MS Morgenwind",
      bookingReference: "NL-50977",
      price: 1150,
    });
    // Five stops, a multi-word port, and nothing from the payment plan below.
    expect(cruises[0].stops.map((s) => s.portName ?? "(sea)")).toEqual([
      "Warnemünde",
      "Kopenhagen",
      "(sea)",
      "Las Palmas de Probe",
      "Warnemünde",
    ]);
  });

  it("declines another cruise line's confirmation", () => {
    expect(read(CRUISE_FOREIGN, "Ihre Reisebestätigung – Südwind Kreuzfahrten")).toEqual([]);
  });

  it("abstains without a marked itinerary row — a voyage without stops is none", () => {
    const result = deriveCruiseTemplate({
      ...input,
      selections: CRUISE_SELECTIONS.filter((s) => s.label !== "stopPort"),
    });
    expect(result).toEqual({ ok: false, refusal: "cruiseNeedsStopRow" });
  });

  it("abstains when the date and the port of the row are on different lines", () => {
    const result = deriveCruiseTemplate({
      ...input,
      selections: [
        ...CRUISE_SELECTIONS.filter((s) => s.label !== "stopPort"),
        select(CRUISE_SOURCE, "Oslo", "stopPort"),
      ],
    });
    expect(result).toEqual({ ok: false, refusal: "cruiseStopRowNotOneLine" });
  });

  it("abstains when the row's date is not a date it can read", () => {
    const text = CRUISE_SOURCE.replace("02.06.2027", "2. Juno");
    const result = deriveCruiseTemplate({
      ...input,
      fullText: text,
      selections: [
        ...CRUISE_SELECTIONS.filter((s) => s.label !== "stopDate" && s.label !== "stopPort"),
        select(text, "2. Juno", "stopDate"),
        select(text, "Kiel", "stopPort", 2),
      ],
    });
    expect(result).toEqual({ ok: false, refusal: "dateNotUnderstood" });
  });

  it("abstains when nothing names the sender, only this booking", () => {
    const result = deriveCruiseTemplate({
      ...input,
      subject: "Buchung",
      selections: CRUISE_SELECTIONS.filter((s) => s.label !== "cruiseLine"),
    });
    expect(result).toEqual({ ok: false, refusal: "noDistinguishingMarker" });
  });
});
