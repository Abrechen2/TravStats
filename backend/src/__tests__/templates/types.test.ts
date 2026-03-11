import { isValidAirlineTemplate } from "../../services/parsers/templates/types";

describe("isValidAirlineTemplate", () => {
  it("accepts a minimal valid template", () => {
    const template = {
      airline: "Lufthansa",
      iata: "LH",
      version: "2024-03",
      from: ["@lufthansa.com"],
      subject: ["Buchungsbestätigung"],
      selectors: { flightNumber: ".flight-no" },
      transforms: {},
      testCases: [],
    };
    expect(isValidAirlineTemplate(template)).toBe(true);
  });

  it("rejects template missing required fields", () => {
    expect(isValidAirlineTemplate({ airline: "LH" })).toBe(false);
  });
});
