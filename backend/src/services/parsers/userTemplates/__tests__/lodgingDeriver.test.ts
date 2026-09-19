import { describe, it, expect } from "@jest/globals";
import { deriveLodgingTemplate } from "../lodgingDeriver";
import { applyLodgingTemplate } from "../../../lodging/templates/engine";
import type { AnnotationSelection } from "../annotations";

/**
 * forgejo#124 phase 6 — what the workshop derives for a hotel mail.
 *
 * The point of the test is the SECOND mail. Reading back the document a
 * template was derived from proves only that the patterns were copied out of
 * it; a template is worth having when it reads the next mail from the same
 * sender, which is what the preview's held-out side checks at runtime and
 * what this pins in the derivation itself.
 *
 * The samples here are written by hand on purpose. The owner's real corpus
 * lives under `test-samples/` and is never committed (`scripts/parser-corpus.ts`
 * header), so a committed test may not depend on it.
 */

const mailFor = (opts: {
  name: string;
  checkIn: string;
  checkOut: string;
  total: string;
  ref: string;
}): string =>
  [
    "From: reservations@hotel-beispiel.test",
    "Subject: Ihre Buchungsbestätigung",
    "",
    "Hotel Beispiel",
    "Reservierungsbestätigung",
    "",
    `Unterkunft: ${opts.name}`,
    `Anreise: ${opts.checkIn}`,
    `Abreise: ${opts.checkOut}`,
    `Gesamtpreis: ${opts.total} EUR`,
    `Buchungsnummer: ${opts.ref}`,
    "",
    "Wir freuen uns auf Ihren Besuch.",
  ].join("\n");

/** The mail the user annotated. */
const SOURCE = mailFor({
  name: "Hotel Beispiel Nürnberg",
  checkIn: "10. März 2026",
  checkOut: "12. März 2026",
  total: "248,00",
  ref: "260308233983",
});

/** A second confirmation from the same sender, never seen by the derivation. */
const HELD_OUT = mailFor({
  name: "Hotel Beispiel Hamburg",
  checkIn: "3. Mai 2026",
  checkOut: "5. Mai 2026",
  total: "319,50",
  ref: "260501777001",
});

function select(text: string, value: string, label: string): AnnotationSelection {
  const start = text.indexOf(value);
  if (start < 0) throw new Error(`sample does not contain ${value}`);
  return { start, end: start + value.length, text: value, label };
}

const annotations: AnnotationSelection[] = [
  select(SOURCE, "Hotel Beispiel Nürnberg", "hotelName"),
  select(SOURCE, "10. März 2026", "checkIn"),
  select(SOURCE, "12. März 2026", "checkOut"),
  select(SOURCE, "248,00 EUR", "totalPrice"),
  select(SOURCE, "260308233983", "confirmationNumber"),
];

const input = {
  id: "lodging:user:test",
  name: "hotel-beispiel.test",
  subject: "Ihre Buchungsbestätigung",
  fullText: SOURCE,
  selections: annotations,
  senderDomain: "hotel-beispiel.test",
};

describe("a user-derived lodging template", () => {
  it("is the same kind of spec the built-in readers are", () => {
    const derived = deriveLodgingTemplate(input);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.template.required).toEqual(["hotelName", "checkIn", "checkOut"]);
    expect(derived.template.match.anchors.length).toBeGreaterThan(0);
    expect(derived.template.fields.checkIn?.transform).toBe("germanDate");
  });

  it("reads the mail it was derived from", () => {
    const derived = deriveLodgingTemplate(input);
    if (!derived.ok) throw new Error(`expected a template, got ${derived.refusal}`);
    const read = applyLodgingTemplate(derived.template, "Ihre Buchungsbestätigung", SOURCE);
    expect(read).not.toBeNull();
    expect(read?.hotelName).toBe("Hotel Beispiel Nürnberg");
    expect(read?.checkIn).toBe("2026-03-10");
    expect(read?.checkOut).toBe("2026-03-12");
    expect(read?.nights).toBe(2);
  });

  it("reads a HELD-OUT mail from the same sender", () => {
    const derived = deriveLodgingTemplate(input);
    if (!derived.ok) throw new Error(`expected a template, got ${derived.refusal}`);
    const read = applyLodgingTemplate(derived.template, "Ihre Buchungsbestätigung", HELD_OUT);
    expect(read).not.toBeNull();
    expect(read?.hotelName).toBe("Hotel Beispiel Hamburg");
    expect(read?.checkIn).toBe("2026-05-03");
    expect(read?.checkOut).toBe("2026-05-05");
    expect(read?.confirmationNumber).toBe("260501777001");
  });

  it("declines a document from somebody else", () => {
    const derived = deriveLodgingTemplate(input);
    if (!derived.ok) throw new Error(`expected a template, got ${derived.refusal}`);
    const foreign = [
      "Subject: Your stay is confirmed",
      "Check In: Oct 01",
      "Check Out: Oct 03",
    ].join("\n");
    expect(applyLodgingTemplate(derived.template, "Your stay is confirmed", foreign)).toBeNull();
  });

  it("abstains rather than deriving a template with no dates", () => {
    const derived = deriveLodgingTemplate({
      ...input,
      selections: [select(SOURCE, "Hotel Beispiel Nürnberg", "hotelName")],
    });
    expect(derived).toEqual({ ok: false, refusal: "lodgingNeedsNameAndDates" });
  });

  it("refuses a subject that names no sender, even with everything else marked", () => {
    // "Ihre Buchungsbestätigung" is the subject Booking.com, a Pension and a
    // chain hotel all send (plan §7: "'Your reservation' is a subject a dozen
    // chains share"). With no From line to fall back on there is nothing that
    // identifies this sender, and a template anchored on the generic words
    // would claim the next hotel mail that arrives.
    const anonymous = SOURCE.split("\n")
      .filter((line) => !line.startsWith("From:"))
      .join("\n");
    const derived = deriveLodgingTemplate({
      ...input,
      senderDomain: undefined,
      fullText: anonymous,
      selections: [
        select(anonymous, "Hotel Beispiel Nürnberg", "hotelName"),
        select(anonymous, "10. März 2026", "checkIn"),
        select(anonymous, "12. März 2026", "checkOut"),
      ],
    });
    expect(derived).toEqual({ ok: false, refusal: "noDistinguishingMarker" });
  });

  it("accepts a subject that carries a brand name", () => {
    const branded = SOURCE.replace(
      "Subject: Ihre Buchungsbestätigung",
      "Subject: Ihre Buchung im Hotel Beispiel"
    );
    const derived = deriveLodgingTemplate({
      ...input,
      senderDomain: undefined,
      subject: "Ihre Buchung im Hotel Beispiel",
      fullText: branded,
      selections: [
        select(branded, "Hotel Beispiel Nürnberg", "hotelName"),
        select(branded, "10. März 2026", "checkIn"),
        select(branded, "12. März 2026", "checkOut"),
      ],
    });
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.template.match.anchors[0]).toContain("Beispiel");
  });

  it("ignores a mark carrying another domain's label", () => {
    const derived = deriveLodgingTemplate({
      ...input,
      selections: [...annotations, select(SOURCE, "Hotel Beispiel", "flightNumber")],
    });
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    // Not stored as a lodging rule under a name the engine will never read.
    expect(Object.keys(derived.template.fields)).not.toContain("flightNumber");
  });

  it("abstains when the date format is one no transform understands", () => {
    // "10.03.2026" — neither `parseGermanDate` (month names only) nor
    // `parseEnglishDate` reads it, so a template built on it would match
    // every mail this sender ever sends and decline all of them.
    const numeric = SOURCE.replace("10. März 2026", "10.03.2026").replace(
      "12. März 2026",
      "12.03.2026"
    );
    const derived = deriveLodgingTemplate({
      ...input,
      fullText: numeric,
      selections: [
        select(numeric, "Hotel Beispiel Nürnberg", "hotelName"),
        select(numeric, "10.03.2026", "checkIn"),
        select(numeric, "12.03.2026", "checkOut"),
      ],
    });
    expect(derived).toEqual({ ok: false, refusal: "lodgingDateNotUnderstood" });
  });
});
