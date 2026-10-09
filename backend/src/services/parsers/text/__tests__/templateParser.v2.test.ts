import { TemplateParser } from "../templateParser";
import { templateRegistry } from "../../templates/registry";
import { validateEnvelope, type TemplateEnvelope } from "../../templates/v2/envelope";
import type { AirlineTemplate } from "../../templates/types";

/**
 * Plan 2026-10-09 P4a: v2 template files read flight mails BEFORE the v1
 * airline templates, and a v1 template whose name a v2 file carries is never
 * consulted — the remote v1 index still lists older Lufthansa templates, and
 * a declined v2 reading must not fall through to them.
 */
function v2(id: string, markers: string[], flightPattern = "^Flight (XX\\d+)$"): TemplateEnvelope {
  const result = validateEnvelope({
    id,
    domain: "flight",
    version: "1.0.0",
    issuer: { name: "Example Air", kind: "airline" },
    markets: [],
    match: { markers, anchors: ["flight"], notBookingIf: ["cancelled"] },
    extraction: {
      repeats: {
        legs: {
          mode: "split",
          splitPattern: "^Leg$",
          wholeTextUnlessSplit: true,
          required: ["flightNumber"],
          fields: {
            flightNumber: { patterns: [flightPattern] },
            departureCode: { patterns: ["^From ([A-Z]{3})$"] },
            arrivalCode: { patterns: ["^To ([A-Z]{3})$"] },
            departureTime: { patterns: ["^Dep (\\S+)$"], transform: "dateTime" },
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

/** A v1 template that would read ANY mail with a flight number — the reading v2 must shadow. */
const V1_XX: AirlineTemplate = {
  airline: "Example Air (v1)",
  iata: "XX",
  version: "2020-01",
  from: [],
  subject: [],
  selectors: {},
  textPatterns: { flightNumber: ["(XX\\d+)"] },
  transforms: {},
  testCases: [],
};

const MAIL = [
  "Example Air flight confirmation",
  "Flight XX123",
  "From MUC",
  "To HAM",
  "Dep 2026-10-01T08:00",
].join("\n");

describe("TemplateParser — v2 files before v1 airline templates", () => {
  afterEach(() => jest.restoreAllMocks());

  function stub(v2Templates: TemplateEnvelope[], v1: AirlineTemplate | null): void {
    jest
      .spyOn(templateRegistry, "getActiveV2")
      .mockImplementation((domain) => (domain === "flight" ? v2Templates : []));
    jest.spyOn(templateRegistry, "getTemplate").mockReturnValue(v1);
  }

  it("answers with the v2 file's legs and its v1-style name", async () => {
    stub([v2("flight:XX", ["example air"])], V1_XX);
    const r = await new TemplateParser().read("Your trip", MAIL, "");
    expect(r.nonBooking).toBe(false);
    expect(r.flights.map((f) => [f.flightNumber, f.departureCode, f.parserTemplate])).toEqual([
      ["XX123", "MUC", "XX"],
    ]);
  });

  it("ends the search on the v2 file's own cancellation notice", async () => {
    stub([v2("flight:XX", ["example air"])], V1_XX);
    const r = await new TemplateParser().read(
      "Cancelled",
      `${MAIL}\nYour flight was cancelled`,
      ""
    );
    expect(r).toEqual({ flights: [], nonBooking: true });
  });

  it("requires whole legs from a v2 file reached after another declined", async () => {
    const partial = MAIL.replace("To HAM\n", "");
    const readsNothing = v2("flight:AA", ["example air"], "^Flight (AA\\d+)$");
    stub([readsNothing, v2("flight:XX", ["example air"])], null);
    expect((await new TemplateParser().read("t", partial, "")).flights).toEqual([]);
    stub([v2("flight:XX", ["example air"])], null);
    expect((await new TemplateParser().read("t", partial, "")).flights).toHaveLength(1);
  });

  it("never falls back to a v1 template that a v2 file of the same name replaced", async () => {
    const v1Ryanair: AirlineTemplate = {
      ...V1_XX,
      iata: "FR",
      textPatterns: { flightNumber: ["(FR\\d+)"] },
    };
    const mail = "Ryanair flight confirmation\nFR1234";
    // A v2 file named FR that declines this mail: the v1 FR template stays silent.
    stub([v2("flight:FR", ["ryanair"])], v1Ryanair);
    expect((await new TemplateParser().read("t", mail, "")).flights).toEqual([]);
    // With no v2 file of that name, the v1 template is the reader it always was.
    stub([], v1Ryanair);
    const r = await new TemplateParser().read("t", mail, "");
    expect(r.flights.map((f) => [f.flightNumber, f.parserTemplate])).toEqual([["FR1234", "FR"]]);
  });
});
