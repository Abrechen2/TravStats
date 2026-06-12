import { expandPortSearchTerms } from "../services/portExonyms";

describe("expandPortSearchTerms", () => {
  it("maps a full German exonym to the English catalog name", () => {
    expect(expandPortSearchTerms("Lissabon")).toContain("Lisbon");
    expect(expandPortSearchTerms("Kopenhagen")).toContain("Copenhagen");
    expect(expandPortSearchTerms("Venedig")).toContain("Venice");
  });

  it("matches while the user is still typing (prefix)", () => {
    expect(expandPortSearchTerms("Lissab")).toContain("Lisbon");
    expect(expandPortSearchTerms("Vened")).toContain("Venice");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(expandPortSearchTerms("  lISSABON ")).toContain("Lisbon");
  });

  it("returns nothing for very short queries", () => {
    expect(expandPortSearchTerms("li")).toEqual([]);
  });

  it("returns nothing for English names or unknown queries", () => {
    expect(expandPortSearchTerms("Lisbon")).toEqual([]);
    expect(expandPortSearchTerms("Atlantis")).toEqual([]);
  });
});
