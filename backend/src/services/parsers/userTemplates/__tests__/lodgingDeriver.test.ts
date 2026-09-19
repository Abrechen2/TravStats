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

  describe("a subject that is only the booking engine's grammar", () => {
    /**
     * Review of `fix/workshop-lodging-derivation`, finding 2.
     *
     * "Ihre Reservierung wurde bestätigt" is the subject a booking engine
     * sends for EVERY property on it. It survived `GENERIC_SUBJECT_WORDS`
     * because the list held the nouns and not the grammar around them, so the
     * first property to derive a template claimed every other property's mail
     * — and proposed ITS fields for them, which is the plausible wrong value
     * that costs most.
     */
    const engineMail = (): string =>
      [
        "Unterkunft: Hotel Beispiel Nürnberg",
        "Anreise: 10. März 2026",
        "Abreise: 12. März 2026",
      ].join("\n");

    const derive = (subject: string) => {
      const text = engineMail();
      return deriveLodgingTemplate({
        ...input,
        senderDomain: undefined,
        subject,
        fullText: text,
        selections: [
          select(text, "Hotel Beispiel Nürnberg", "hotelName"),
          select(text, "10. März 2026", "checkIn"),
          select(text, "12. März 2026", "checkOut"),
        ],
      });
    };

    it("is not a name, so nothing is derived from it", () => {
      expect(derive("Ihre Reservierung wurde bestätigt")).toEqual({
        ok: false,
        refusal: "noDistinguishingMarker",
      });
    });

    it("is not a name even when the sender's own labels supply the only odd word", () => {
      // "Anreise" is this sender's label for a field. A subject built out of
      // the words the body already prints beside its values describes the
      // FORM, not the author.
      expect(derive("Ihre Unterkunft und Anreise")).toEqual({
        ok: false,
        refusal: "noDistinguishingMarker",
      });
    });

    it("still takes a real brand out of the same shape of subject", () => {
      const derived = derive("Ihre Reservierung im Seehotel wurde bestätigt");
      expect(derived.ok).toBe(true);
      if (!derived.ok) return;
      expect(derived.template.match.anchors[0]).toContain("Seehotel");
    });

    it("lets a known sender domain carry a template a generic subject cannot", () => {
      const text = engineMail();
      const withDomain = deriveLodgingTemplate({
        ...input,
        subject: "Ihre Reservierung wurde bestätigt",
        senderDomain: "hotel-beispiel.test",
        fullText: [text, "Hotel Beispiel, hotel-beispiel.test"].join("\n"),
        selections: [
          select(text, "Hotel Beispiel Nürnberg", "hotelName"),
          select(text, "10. März 2026", "checkIn"),
          select(text, "12. März 2026", "checkOut"),
        ],
      });
      expect(withDomain.ok).toBe(true);
      if (!withDomain.ok) return;
      expect(withDomain.template.match.anchors).toEqual(["hotel-beispiel.test"]);
    });
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

  describe("a name with no label in front of it", () => {
    /**
     * The letterhead case, and the one the beta audit hit (2026-09-19, NOT
     * FIXED 5a): the hotel's name on a line of its own at the top of the mail,
     * with nothing before it. `labelContextOf` answers null there, the field
     * was skipped, and the derivation then refused with "too little marked —
     * without a name, an arrival and a departure it is not a stay", for an
     * annotation whose name WAS marked. A wrong reason sends the user back to
     * mark something that is already marked.
     */
    const LETTERHEAD = [
      "Hotel Seeblick Garni",
      "",
      "Anreise: 10. März 2026",
      "Abreise: 12. März 2026",
    ].join("\n");

    const LETTERHEAD_SUBJECT = "Ihre Buchung im Hotel Seeblick";

    const letterheadInput = {
      ...input,
      subject: LETTERHEAD_SUBJECT,
      senderDomain: undefined,
      fullText: LETTERHEAD,
      selections: [
        // Offset 0 — nothing precedes it, in the text or in the 80 characters
        // `labelContextOf` looks back over.
        { start: 0, end: 20, text: "Hotel Seeblick Garni", label: "hotelName" },
        select(LETTERHEAD, "10. März 2026", "checkIn"),
        select(LETTERHEAD, "12. März 2026", "checkOut"),
      ],
    };

    it("is read by its own line instead of being dropped", () => {
      const derived = deriveLodgingTemplate(letterheadInput);
      if (!derived.ok) throw new Error(`expected a template, got ${derived.refusal}`);
      const rule = derived.template.fields.hotelName;
      expect(rule?.stacked).toBeUndefined();
      expect(rule?.patterns?.[0]).toBe("^[ \\t]*(Hotel\\s+Seeblick\\s+Garni)[ \\t]*$");
      expect(rule?.flags).toBe("im");
    });

    it("reads the name back out of the mail it came from", () => {
      const derived = deriveLodgingTemplate(letterheadInput);
      if (!derived.ok) throw new Error(`expected a template, got ${derived.refusal}`);
      const read = applyLodgingTemplate(derived.template, LETTERHEAD_SUBJECT, LETTERHEAD);
      expect(read?.hotelName).toBe("Hotel Seeblick Garni");
      expect(read?.checkIn).toBe("2026-03-10");
    });

    it("reads a second mail from the same property", () => {
      // The property is the same, so its letterhead is — which is why the
      // value stays literal rather than being generalised into a shape that
      // would also claim the next line beginning with "Hotel".
      const derived = deriveLodgingTemplate(letterheadInput);
      if (!derived.ok) throw new Error(`expected a template, got ${derived.refusal}`);
      const second = LETTERHEAD.replace("10. März 2026", "4. Mai 2026").replace(
        "12. März 2026",
        "7. Mai 2026"
      );
      const read = applyLodgingTemplate(derived.template, LETTERHEAD_SUBJECT, second);
      expect(read?.hotelName).toBe("Hotel Seeblick Garni");
      expect(read?.checkIn).toBe("2026-05-04");
      expect(read?.checkOut).toBe("2026-05-07");
    });

    it("still prefers the label when the sender printed one above the name", () => {
      // The other half of the same mail shape, and the more common one: the
      // name on its own line UNDER "Unterkunft:". That must keep being a
      // stacked read — the engine walks down from the label, which is what
      // copes with the blank line a sender puts between the two.
      const labelled = [
        "Unterkunft:",
        "Hotel Seeblick Garni",
        "Anreise: 10. März 2026",
        "Abreise: 12. März 2026",
      ].join("\n");
      const derived = deriveLodgingTemplate({
        ...letterheadInput,
        fullText: labelled,
        selections: [
          select(labelled, "Hotel Seeblick Garni", "hotelName"),
          select(labelled, "10. März 2026", "checkIn"),
          select(labelled, "12. März 2026", "checkOut"),
        ],
      });
      if (!derived.ok) throw new Error(`expected a template, got ${derived.refusal}`);
      expect(derived.template.fields.hotelName?.stacked).toBe("Unterkunft:");
      expect(derived.template.fields.hotelName?.patterns).toBeUndefined();
      const read = applyLodgingTemplate(derived.template, LETTERHEAD_SUBJECT, labelled);
      expect(read?.hotelName).toBe("Hotel Seeblick Garni");
    });
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
