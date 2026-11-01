import { describe, it, expect } from "vitest";
import {
  buildTemplateIssue,
  findPersonalText,
  MAX_ISSUE_URL_LENGTH,
  TEMPLATE_REPO_ISSUE_URL,
} from "../communityIssue";

describe("findPersonalText (forgejo#330: nothing personal leaves in a public issue)", () => {
  it("flags an e-mail address", () => {
    expect(findPersonalText({ match: { anchors: ["max.mustermann@example.org"] } })).toEqual([
      "email",
    ]);
  });
  it("flags a phone number, with and without separators", () => {
    expect(findPersonalText("Hotline +49 170 1234567")).toContain("phone");
    expect(findPersonalText("0170-123 45 67")).toContain("phone");
  });
  it("flags a booking code that mixes capitals and digits", () => {
    expect(findPersonalText(["Buchung X7K2QP bestätigt"])).toEqual(["bookingCode"]);
    expect(findPersonalText("ABC123")).toEqual(["bookingCode"]);
  });
  it("flags a long number such as a ticket number", () => {
    expect(findPersonalText("Ticket 1234567890123")).toContain("longNumber");
  });
  it("walks nested objects and arrays", () => {
    expect(findPersonalText({ a: [{ b: "mail me@x.de" }] })).toEqual(["email"]);
  });
  it("lets a pattern, a label and a plain word through", () => {
    expect(
      findPersonalText({
        match: { anchors: ["Ihre Buchung"], markers: ["FÄHRE", "TICKET"] },
        extraction: {
          fields: { ref: "Buchungscode:\\s*([A-Z0-9]{6})", date: "\\d{2}\\.\\d{2}\\.\\d{4}" },
        },
      })
    ).toEqual([]);
  });
});

describe("buildTemplateIssue", () => {
  const template = {
    id: "ferry:example-line",
    domain: "ferry",
    issuer: { name: "Example Line" },
    markets: ["DE", "DK"],
    match: { anchors: ["Example Line"] },
  };

  it("carries provider, markets and the JSON in the prefilled form", () => {
    const issue = buildTemplateIssue(template);
    const params = new URL(issue.url).searchParams;
    expect(issue.url.startsWith(TEMPLATE_REPO_ISSUE_URL)).toBe(true);
    expect(params.get("template")).toBe("template-request.yml");
    expect(params.get("provider")).toBe("Example Line");
    expect(params.get("markets")).toBe("DE, DK");
    expect(JSON.parse(params.get("template_json") ?? "")).toEqual(template);
    expect(issue.tooLong).toBe(false);
  });

  it("falls back to a link without the JSON when the full link would be too long", () => {
    const big = {
      ...template,
      match: { anchors: Array.from({ length: 400 }, (_, i) => `anchor ${i}`) },
    };
    const issue = buildTemplateIssue(big);
    expect(issue.url.length).toBeGreaterThan(MAX_ISSUE_URL_LENGTH);
    expect(issue.tooLong).toBe(true);
    expect(issue.urlWithoutJson.length).toBeLessThan(MAX_ISSUE_URL_LENGTH);
    expect(new URL(issue.urlWithoutJson).searchParams.get("template_json")).toBeNull();
    expect(JSON.parse(issue.fields.template_json)).toEqual(big);
  });

  it("copes with a template that names no issuer or markets", () => {
    const issue = buildTemplateIssue({ domain: "bus" });
    expect(issue.fields.provider).toBe("");
    expect(issue.fields.markets).toBe("");
    expect(issue.title).toContain("bus");
  });
});
