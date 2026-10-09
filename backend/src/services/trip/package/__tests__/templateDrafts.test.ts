import { validateEnvelope } from "../../../parsers/templates/v2/envelope";
import { applyTemplate, defaultRunners, runTestCases } from "../../../parsers/templates/v2/runners";
import { tourOperatorTemplate } from "../../../parsers/templates/v2/__tests__/tourOperatorFixture";
import { validatePackageValues } from "../contract";
import { parsePackageText } from "../parsePackage";
import { DRAFT_FILES, loadDrafts, matchInput, readDraft } from "./draftTemplates";

/**
 * The first package templates (plan P3, step G) are proven HERE before they
 * go to the template repository: each must validate, pass its own invented
 * test cases, and — what the repository CI cannot know — read values the
 * package contract accepts. A draft that passed its own cases but broke the
 * contract would load, activate, and then never produce a trip.
 */
describe("Berge & Meer package drafts", () => {
  it.each(DRAFT_FILES)("%s validates and passes its own test cases", (file) => {
    const checked = validateEnvelope(readDraft(file));
    if (!checked.ok) throw new Error(checked.errors.join("; "));
    expect(checked.template.issuer.kind).toBe("tour-operator");
    expect(checked.template.markets).toEqual(["DE", "AT", "CH"]);
    expect(runTestCases(checked.template, defaultRunners)).toEqual({ kind: "passed" });
  });

  it.each(DRAFT_FILES)("%s reads values the package contract accepts", (file) => {
    const template = loadDrafts().find((t) => file.startsWith(t.id.split(":")[1]))!;
    const applied = applyTemplate(template, matchInput(template));
    expect(applied.matched).toBe(true);
    const checked = validatePackageValues(applied.values);
    if (!checked.ok) throw new Error(checked.issues.join("; "));
    // The operator's zero-padded "GF 0086" is the airline's GF86.
    expect(checked.contract.flights.map((f) => f.flightNumber)).not.toContain("GF0086");
  });
});

describe("parsePackageText", () => {
  const drafts = loadDrafts();
  const [invoice, documents] = drafts;

  it("reads the invoice with the invoice template", () => {
    const result = parsePackageText(matchInput(invoice), drafts);
    expect(result.template?.id).toBe("package:berge-meer-invoice");
    expect(result.reading?.bookingReference).toBe("9Z123456");
    expect(result.reading?.totalPrice).toBe(3249);
    expect(result.reading?.flights).toHaveLength(4);
  });

  it("reads the travel documents with the documents template", () => {
    const result = parsePackageText(matchInput(documents), drafts);
    expect(result.template?.id).toBe("package:berge-meer-documents");
    expect(result.reading?.flights.map((f) => f.flightNumber)).toEqual([
      "GF86",
      "GF156",
      "GF157",
      "GF17",
    ]);
    expect(result.reading?.stays.map((s) => s.city)).toEqual(["Hanoi", "Hue", "Hanoi"]);
  });

  it("says no template recognised the document, rather than returning an empty trip", () => {
    const result = parsePackageText("Ein Brief ohne Reise", drafts);
    expect(result).toMatchObject({ reading: null, template: null, fallbackCode: "noTemplate" });
  });

  it("names the template and the paths when a recognising template breaks the contract", () => {
    // The P2 fixture reads `bookingNumber`, `from`/`to` — not the contract's names.
    const fixture = validateEnvelope(tourOperatorTemplate());
    if (!fixture.ok) throw new Error(fixture.errors.join("; "));
    const input = matchInput(fixture.template);
    const result = parsePackageText(input, [fixture.template]);
    expect(result.reading).toBeNull();
    expect(result.fallbackCode).toBe("invalidReading");
    expect(result.template?.id).toBe("package:sonnenweg-example");
    expect(result.issues?.some((i) => i.startsWith("bookingReference"))).toBe(true);
  });

  it("ignores templates of other domains", () => {
    const asFlight = { ...invoice, domain: "flight" as const, id: "flight:x" };
    expect(parsePackageText(matchInput(invoice), [asFlight]).fallbackCode).toBe("noTemplate");
  });
});
