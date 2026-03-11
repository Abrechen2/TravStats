import { applyTemplate } from "../../services/parsers/templates/engine";
import type { AirlineTemplate } from "../../services/parsers/templates/types";

const mockTemplate: AirlineTemplate = {
  airline: "TestAir",
  iata: "TA",
  version: "2024-01",
  from: ["@testair.com"],
  subject: [],
  selectors: {
    flightNumber: ".flight-number",
    departureCode: ".dep-code",
    pnr: ".pnr",
  },
  transforms: {},
  testCases: [],
};

const mockHtml = `
  <html><body>
    <span class="flight-number">TA1234</span>
    <span class="dep-code">FRA</span>
    <span class="pnr">ABC123</span>
  </body></html>
`;

describe("applyTemplate", () => {
  it("extracts fields using CSS selectors", () => {
    const result = applyTemplate(mockTemplate, "", mockHtml);
    expect(result.flightNumber).toBe("TA1234");
    expect(result.departureCode).toBe("FRA");
    expect(result.bookingReference).toBe("ABC123");
    expect(result.parserTemplate).toBe("TA");
  });

  it("applies transform functions to values", () => {
    const templateWithTransform: AirlineTemplate = {
      ...mockTemplate,
      transforms: { flightNumber: "value => value.toLowerCase()" },
    };
    const result = applyTemplate(templateWithTransform, "", mockHtml);
    expect(result.flightNumber).toBe("ta1234");
  });

  it("returns undefined for fields with no matching selector", () => {
    const textOnlyTemplate: AirlineTemplate = {
      ...mockTemplate,
      selectors: { flightNumber: ".nonexistent" },
    };
    const result = applyTemplate(textOnlyTemplate, "Flight TA1234", "");
    expect(result.flightNumber).toBeUndefined();
  });

  it("populates missing array for critical fields not found", () => {
    const result = applyTemplate(mockTemplate, "", "");
    expect(result.missing).toContain("flightNumber");
  });
});
