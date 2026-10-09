/**
 * The `package` parse target (plan 2026-10-09 P3): read by active `package`
 * templates only, and recognised by `auto` through those templates' matchers.
 */
jest.mock("../../parsers/llmAvailability", () => ({
  isLlmAvailable: jest.fn(async () => false),
  recordLlmProbe: jest.fn(),
}));
jest.mock("../../llm/llmGate", () => ({
  ...jest.requireActual("../../llm/llmGate"),
  isLlmEnabledByAdmin: jest.fn(async () => true),
}));

import { parseDocument } from "../parseDocument";
import { scoreDocument, PACKAGE_TEMPLATE_WEIGHT } from "../documentDomain";
import { templateRegistry } from "../../parsers/templates/registry";
import { loadDrafts, matchInput } from "../../trip/package/__tests__/draftTemplates";

const drafts = loadDrafts();
const [invoice] = drafts;

describe("parseDocument — package", () => {
  afterEach(() => jest.restoreAllMocks());

  it("reads a package through the active package template", async () => {
    jest.spyOn(templateRegistry, "getActiveV2").mockReturnValue(drafts);
    const outcome = await parseDocument({
      text: matchInput(invoice),
      domain: "package",
      source: "document",
      userId: "u1",
    });
    expect(outcome.domain).toBe("package");
    expect(outcome.body).toMatchObject({
      domain: "package",
      parserUsed: "template",
      template: { id: "package:berge-meer-invoice", issuer: "Berge & Meer" },
      package: { bookingReference: "9Z123456", totalPrice: 3249, currency: "EUR" },
    });
  });

  it("answers without a template with an empty reading and the reason, never a guess", async () => {
    jest.spyOn(templateRegistry, "getActiveV2").mockReturnValue([]);
    const outcome = await parseDocument({
      text: matchInput(invoice),
      domain: "package",
      source: "document",
      userId: "u1",
    });
    expect(outcome.body).toMatchObject({
      domain: "package",
      package: null,
      parserUsed: "none",
      fallbackCode: "noTemplate",
    });
  });

  it("lets auto detection choose package when a package template recognises the document", async () => {
    jest.spyOn(templateRegistry, "getActiveV2").mockReturnValue(drafts);
    const outcome = await parseDocument({
      text: matchInput(invoice),
      domain: "auto",
      source: "document",
      userId: "u1",
    });
    expect(outcome.domain).toBe("package");
    expect(outcome.domainSource).toBe("detected");
    expect(outcome.detection?.candidates[0].matched).toContain(
      "package-template:package:berge-meer-invoice"
    );
  });
});

describe("scoreDocument — package evidence", () => {
  it("is the template matcher and nothing else", () => {
    const text = matchInput(invoice);
    const without = scoreDocument(text, []);
    expect(without.candidates.find((c) => c.domain === "package")?.score).toBe(0);
    // Without a template, the same invoice is a flight document — which it also is.
    expect(without.domain).toBe("flight");

    const withDrafts = scoreDocument(text, drafts);
    const pkg = withDrafts.candidates.find((c) => c.domain === "package");
    expect(pkg?.score).toBe(PACKAGE_TEMPLATE_WEIGHT);
    expect(withDrafts.domain).toBe("package");
  });
});
