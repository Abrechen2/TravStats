import { validateEnvelope, type TemplateEnvelope } from "../v2/envelope";
import { applyV2FlightTemplate, flightTemplateName } from "../v2Flight";

/** A minimal v2 flight template; `legFields`/`shared` override the extraction. */
function template(
  legFields: Record<string, unknown> = {},
  shared: Record<string, unknown> = {}
): TemplateEnvelope {
  const result = validateEnvelope({
    id: "flight:XX-test",
    domain: "flight",
    version: "1.0.0",
    issuer: { name: "Example Air", kind: "airline", keys: { iata: "XX" } },
    markets: [],
    match: {
      markers: ["example air"],
      anchors: ["booking code"],
      notBookingIf: ["has been cancelled"],
    },
    extraction: {
      fields: shared,
      repeats: {
        legs: {
          mode: "split",
          splitPattern: "^Flight XX",
          required: ["flightNumber"],
          fields: {
            flightNumber: { patterns: ["^Flight (XX ?\\d+)"], transform: "removeSpaces" },
            departureCode: { patterns: ["^From ([A-Z]{3})$"] },
            arrivalCode: { patterns: ["^To ([A-Z]{3})$"] },
            departureTime: {
              patterns: ["^Dep (\\d{2}\\.\\d{2}\\.\\d{4}) (\\d{2}:\\d{2})$"],
              format: "{1}T{2}",
              transform: "dateTime",
            },
            arrivalTime: {
              patterns: ["^Arr (\\d{2}\\.\\d{2}\\.\\d{4}) (\\d{2}:\\d{2})"],
              format: "{1}T{2}",
              transform: "dateTime",
            },
            arrivalDayOffset: { patterns: ["^Arr [^\\n]*(\\+\\d)$"], transform: "dayOffset" },
            ...legFields,
          },
        },
      },
      required: ["legs"],
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
  "Example Air — booking code QX7TST",
  "Flight XX 101",
  "From MUC",
  "To JFK",
  "Dep 31.12.2026 22:15",
  "Arr 31.12.2026 01:30 +1",
  "Flight XX 102",
  "From JFK",
  "Dep 07.01.2027 18:00",
  "Arr 08.01.2027 08:10",
].join("\n");

describe("applyV2FlightTemplate", () => {
  it("maps each leg onto the v1 booking keys, with confidence and missing as v1 counts them", () => {
    const outcome = applyV2FlightTemplate(template(), { subject: "Your trip", text: MAIL });
    expect(outcome.kind).toBe("legs");
    if (outcome.kind !== "legs") return;
    expect(outcome.legs).toEqual([
      {
        flightNumber: "XX101",
        departureCode: "MUC",
        arrivalCode: "JFK",
        departureTime: "2026-12-31T22:15",
        // "+1" across a year end, on the calendar alone.
        arrivalTime: "2027-01-01T01:30",
        missing: [],
        parserTemplate: "XX-test",
        parserConfidence: 100,
      },
      {
        flightNumber: "XX102",
        departureCode: "JFK",
        departureTime: "2027-01-07T18:00",
        arrivalTime: "2027-01-08T08:10",
        missing: ["arrivalCode"],
        parserTemplate: "XX-test",
        parserConfidence: 80,
      },
    ]);
  });

  it("gives every leg a value printed once outside the legs, unless the leg has its own", () => {
    const shared = { pnr: { patterns: ["booking code (\\w+)"] } };
    const outcome = applyV2FlightTemplate(template({}, shared), MAIL);
    expect(outcome.kind === "legs" && outcome.legs.map((l) => [l.pnr, l.bookingReference])).toEqual(
      [
        ["QX7TST", "QX7TST"],
        ["QX7TST", "QX7TST"],
      ]
    );
  });

  it("answers 'not a booking' for the issuer's own cancellation", () => {
    const cancelled = `${MAIL}\nYour booking has been cancelled.`;
    expect(applyV2FlightTemplate(template(), cancelled)).toEqual({ kind: "nonBooking" });
  });

  it("declines a leg without its number, a foreign mail and a template of another domain", () => {
    expect(applyV2FlightTemplate(template(), MAIL.replace("Flight XX 102", "Flight XX"))).toEqual({
      kind: "declined",
    });
    expect(applyV2FlightTemplate(template(), "Some other airline")).toEqual({ kind: "declined" });
    const lodging = { ...template(), domain: "lodging" } as TemplateEnvelope;
    expect(applyV2FlightTemplate(lodging, MAIL)).toEqual({ kind: "declined" });
  });

  it("declines a template whose values have the wrong shape instead of passing them on", () => {
    // A departure that is not a local date-time is a template defect.
    const sloppy = template({ departureTime: { patterns: ["^Dep ([^\\n]+)$"] } });
    expect(applyV2FlightTemplate(sloppy, MAIL)).toEqual({ kind: "declined" });
  });

  it("names the template the way v1 did", () => {
    expect(flightTemplateName(template())).toBe("XX-test");
  });
});
