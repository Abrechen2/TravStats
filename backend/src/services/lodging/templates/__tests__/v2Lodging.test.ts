import { validateEnvelope, type TemplateEnvelope } from "../../../parsers/templates/v2/envelope";
import { applyV2LodgingTemplate, readWithV2LodgingTemplates } from "../v2Lodging";

/** A minimal v2 lodging template; `fields` overrides the extraction's fields. */
function template(fields: Record<string, unknown>, id = "lodging:example"): TemplateEnvelope {
  const result = validateEnvelope({
    id,
    domain: "lodging",
    version: "1.0.0",
    issuer: { name: "Example Hotels", kind: "hotel-chain" },
    markets: [],
    match: { markers: ["example hotels"], anchors: ["reservierung nr."] },
    extraction: {
      fields: {
        hotelName: { patterns: ["Hotel: ([^\\n]+)"] },
        checkIn: { patterns: ["Anreise: (\\S+)"], transform: "numericDate" },
        checkOut: { patterns: ["Abreise: (\\S+)"], transform: "numericDate" },
        ...fields,
      },
      required: ["hotelName", "checkIn", "checkOut"],
    },
    testCases: [
      { name: "m", input: "x", expect: "match" },
      { name: "d", input: "y", expect: "decline" },
    ],
  });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.template;
}

const MAIL = [
  "Example Hotels — Reservierung Nr. ABC123",
  "Hotel: Example Hotel Musterstadt",
  "Anreise: 01.10.2026",
  "Abreise: 03.10.2026",
  "Gesamt: 210,00 EUR",
].join("\n");

describe("applyV2LodgingTemplate", () => {
  it("turns a template's values into a stay, with type and chain from constant fields", () => {
    const t = template({
      totalPrice: { patterns: ["Gesamt: ([\\d.,]+)"], transform: "money" },
      currency: { patterns: ["Gesamt: [\\d.,]+ ([A-Z]{3})"], transform: "currency" },
      type: { value: "hotel" },
      chainName: { value: "Example" },
    });
    const r = applyV2LodgingTemplate(t, MAIL.split("\n")[0], MAIL);
    expect(r).toMatchObject({
      hotelName: "Example Hotel Musterstadt",
      checkIn: "2026-10-01",
      checkOut: "2026-10-03",
      nights: 2,
      totalPrice: 210,
      currency: "EUR",
      type: "hotel",
      chainName: "Example",
      parserTemplate: "example",
    });
  });

  it("declines a template whose values have the wrong shape instead of coercing them", () => {
    // A guest count read as text and a type the app does not know are template
    // defects; the stay is not proposed with them quietly dropped.
    expect(applyV2LodgingTemplate(template({ guests: { value: "two" } }), "", MAIL)).toBeNull();
    expect(applyV2LodgingTemplate(template({ type: { value: "castle" } }), "", MAIL)).toBeNull();
  });

  it("declines when the matcher declines or a required value is missing", () => {
    const t = template({});
    expect(applyV2LodgingTemplate(t, "Newsletter", "Example Hotels says hello")).toBeNull();
    expect(applyV2LodgingTemplate(t, "", MAIL.replace("Anreise: 01.10.2026", ""))).toBeNull();
  });

  it("ignores a template of another domain", () => {
    const flight = { ...template({}), domain: "flight" } as TemplateEnvelope;
    expect(applyV2LodgingTemplate(flight, "", MAIL)).toBeNull();
  });

  it("readWithV2LodgingTemplates takes the first template that reads the document", () => {
    const declines = template({ hotelName: { patterns: ["Nope: (.+)"] } }, "lodging:first");
    const reads = template({}, "lodging:second");
    expect(readWithV2LodgingTemplates([declines, reads], "", MAIL)?.parserTemplate).toBe("second");
    expect(readWithV2LodgingTemplates([], "", MAIL)).toBeNull();
  });
});
