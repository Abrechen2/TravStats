import { getVendoredLogo, vendoredAirlineCount } from "../vendoredLogos";

/**
 * The vendored set is the keyless DEFAULT: a self-hosted instance with no API
 * key must still get real logos, from our own repository rather than an external
 * hotlink. These tests pin the contract of that tier — resolution by whatever
 * code the caller happens to hold, honest misses, and no path escape.
 */
describe("vendoredLogos", () => {
  it("ships the whole snapshot, not a sample", () => {
    expect(vendoredAirlineCount()).toBe(93);
  });

  it("resolves by IATA code", () => {
    const logo = getVendoredLogo("LH", "logo");
    expect(logo).not.toBeNull();
    expect(logo?.contentType).toBe("image/svg+xml");
    expect(logo?.body.toString("utf8")).toContain("<svg");
  });

  it("resolves by ICAO code — bookings often carry only that one", () => {
    const byIcao = getVendoredLogo("DLH", "logo");
    const byIata = getVendoredLogo("LH", "logo");
    expect(byIcao).not.toBeNull();
    expect(byIcao?.body.toString("utf8")).toBe(byIata?.body.toString("utf8"));
  });

  it("is case-insensitive", () => {
    expect(getVendoredLogo("lh", "logo")).not.toBeNull();
  });

  it("serves the icon variant", () => {
    const icon = getVendoredLogo("LH", "icon");
    const logo = getVendoredLogo("LH", "logo");
    expect(icon).not.toBeNull();
    expect(icon?.body.toString("utf8")).not.toBe(logo?.body.toString("utf8"));
  });

  /**
   * Coverage is uneven by design: 83 airlines have a wordmark, 39 a monochrome
   * one, only 3 a tail. A variant the snapshot does not hold must MISS rather
   * than silently serve a different one — the caller then falls through to the
   * next tier, which is the whole point of the chain.
   */
  it("misses a variant it does not hold instead of substituting another", () => {
    expect(getVendoredLogo("LH", "tail")).toBeNull();
  });

  it("misses an airline it does not know", () => {
    // American Airlines is genuinely absent from the snapshot (measured against
    // the production data: 14 % of flights fall through to the next tier).
    expect(getVendoredLogo("AA", "logo")).toBeNull();
    expect(getVendoredLogo("ZZZ", "logo")).toBeNull();
  });

  it("refuses a code that tries to escape the asset directory", () => {
    expect(getVendoredLogo("../../../../etc/passwd", "logo")).toBeNull();
    expect(getVendoredLogo("..%2F..%2Fetc", "logo")).toBeNull();
  });
});
