import { describe, it, expect } from "@jest/globals";
import { deriveRentalTemplate } from "../rentalDeriver";
import { applyV2RentalTemplate } from "../../../rental/parser/v2Rental";
import { workshopEnvelopeSchema } from "../../templates/v2/envelope";
import { previewTemplate } from "../preview";
import type { UserTemplate } from "../types";
import { select } from "./workshopSamples";
import {
  RENTAL_FOREIGN,
  RENTAL_HELD_OUT,
  RENTAL_SELECTIONS,
  RENTAL_SOURCE,
  RENTAL_SUBJECT,
} from "./rentalSamples";

/**
 * forgejo#309 — the workshop derives a rental template: one label pattern per
 * mark, each end's day and clock joined by the rental consumer
 * (`v2Rental.ts`), which this runs for real.
 */
const input = {
  trainingDataId: "td-rental-1",
  subject: RENTAL_SUBJECT,
  fullText: RENTAL_SOURCE,
  selections: RENTAL_SELECTIONS,
};

function derived() {
  const result = deriveRentalTemplate(input);
  if (!result.ok) throw new Error(`derivation refused: ${result.refusal}`);
  return result.template;
}

const read = (text: string, subject = RENTAL_SUBJECT) =>
  applyV2RentalTemplate(derived(), { subject, text });

const without = (...labels: string[]) => RENTAL_SELECTIONS.filter((s) => !labels.includes(s.label));

describe("deriveRentalTemplate", () => {
  it("writes a rental workshop envelope the shared schema accepts", () => {
    const t = derived();
    expect(workshopEnvelopeSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({ id: "rental:user-td-rental-1", domain: "rental" });
  });

  it("reads its own sample: provider, number, both ends with their clocks, vehicle, price", () => {
    expect(read(RENTAL_SOURCE)).toMatchObject({
      kind: "confirmation",
      provider: "Mietwagenfern GmbH",
      confirmationNumber: "MF-778812",
      pickup: { stationName: "Musterfurt Flughafen Terminal 2", local: "2027-11-14T10:30" },
      return: { stationName: "Musterfurt Hauptbahnhof", local: "2027-11-21T09:00" },
      vehicleClass: "Kompaktklasse",
      price: 312.5,
    });
  });

  it("reads the provider's next booking — a return without a clock stays a bare day", () => {
    expect(read(RENTAL_HELD_OUT)).toMatchObject({
      confirmationNumber: "MF-903311",
      pickup: { stationName: "Probestadt Innenstadt", local: "2028-02-02T08:00" },
      return: { stationName: "Probestadt Innenstadt", local: "2028-02-06" },
      vehicleClass: "Mittelklasse Kombi",
    });
  });

  it("declines another provider's confirmation", () => {
    expect(read(RENTAL_FOREIGN, "Ihre Buchung bei Fremdling")).toBeNull();
  });

  it("abstains without the provider or without a confirmation's required fields", () => {
    expect(deriveRentalTemplate({ ...input, selections: without("provider") })).toEqual({
      ok: false,
      refusal: "rentalNeedsProvider",
    });
    expect(deriveRentalTemplate({ ...input, selections: without("returnDate") })).toEqual({
      ok: false,
      refusal: "rentalNeedsBookingFields",
    });
  });

  it("abstains when pickup and return are labelled alike — one rule would read the other end", () => {
    const text = [
      "Mietwagenfern GmbH",
      "Reservierungsnummer: MF-111222",
      "Abholung",
      "Station: Musterfurt Flughafen",
      "Datum: 14.11.2027",
      "Rückgabe",
      "Station: Musterfurt Hauptbahnhof",
      "Datum: 21.11.2027",
    ].join("\n");
    const at = (value: string, label: string) => select(text, value, label);
    expect(
      deriveRentalTemplate({
        trainingDataId: "td-rental-ambiguous",
        subject: RENTAL_SUBJECT,
        fullText: text,
        selections: [
          at("Mietwagenfern GmbH", "provider"),
          at("MF-111222", "confirmationNumber"),
          at("Musterfurt Flughafen", "pickupStation"),
          at("14.11.2027", "pickupDate"),
          at("Musterfurt Hauptbahnhof", "returnStation"),
          at("21.11.2027", "returnDate"),
        ],
      })
    ).toEqual({ ok: false, refusal: "rentalEndsAmbiguous" });
  });

  it("previews through the same consumer", () => {
    const template: UserTemplate = {
      id: "t-rental",
      userId: "u",
      name: "Mietwagenfern",
      status: "pending",
      fingerprint: { senderDomains: [], subjectPatterns: [], bodyMarkers: [] },
      patterns: derived() as unknown as UserTemplate["patterns"],
      createdAt: "2027-01-01T00:00:00Z",
      updatedAt: "2027-01-01T00:00:00Z",
    };
    const own = previewTemplate("rental", template, RENTAL_SUBJECT, RENTAL_HELD_OUT);
    expect(own.matched).toBe(true);
    expect(own.fields).toEqual(
      expect.arrayContaining([
        { name: "confirmationNumber", value: "MF-903311" },
        { name: "pickup", value: "2028-02-02T08:00 Probestadt Innenstadt" },
        { name: "return", value: "2028-02-06 Probestadt Innenstadt" },
      ])
    );
    expect(previewTemplate("rental", template, "Fremd", RENTAL_FOREIGN).matched).toBe(false);
  });
});
