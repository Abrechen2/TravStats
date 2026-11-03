import {
  ALLRATESTODAY_URL,
  FRANKFURTER_URL,
  fxSourceUrl,
  normalizeFxCustomUrl,
} from "../fxSources";

describe("custom FX source URL validation (#391)", () => {
  it("accepts http(s) bases and trims trailing slashes", () => {
    expect(normalizeFxCustomUrl("https://fx.example.org/v1/")).toBe("https://fx.example.org/v1");
    expect(normalizeFxCustomUrl("http://192.168.1.5:8080")).toBe("http://192.168.1.5:8080");
  });

  it.each([
    "ftp://fx.example.org",
    "javascript:alert(1)",
    "not a url",
    "",
    "https://user:pw@fx.example.org",
    "https://user@fx.example.org",
    "https://fx.example.org/v1?key=1",
    "https://fx.example.org/v1#x",
  ])("rejects %s", (raw) => {
    expect(normalizeFxCustomUrl(raw)).toBeNull();
  });

  it("maps the named sources to their endpoints and unusable choices to null", () => {
    expect(fxSourceUrl({ source: "frankfurter", customUrl: null })).toBe(FRANKFURTER_URL);
    expect(fxSourceUrl({ source: "allratestoday", customUrl: null })).toBe(ALLRATESTODAY_URL);
    expect(fxSourceUrl({ source: "custom", customUrl: "https://a.example/v1" })).toBe(
      "https://a.example/v1"
    );
    expect(fxSourceUrl({ source: "custom", customUrl: null })).toBeNull();
    expect(fxSourceUrl({ source: "custom", customUrl: "ftp://x" })).toBeNull();
    expect(fxSourceUrl({ source: "none", customUrl: null })).toBeNull();
    expect(fxSourceUrl({ source: "bogus", customUrl: null })).toBeNull();
  });
});
