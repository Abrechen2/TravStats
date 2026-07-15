import { getVendoredLogo, vendoredAirlineCount } from "../vendoredLogos";

/**
 * The vendored set is the keyless ICON tier: a self-hosted instance with no
 * API key must still get a real airline mark, from our own repository rather
 * than an external hotlink. These tests pin the contract of that tier —
 * resolution by whatever code the caller happens to hold, honest misses, and
 * no path escape. Wordmark-shaped variants (`logo`, `tail`) are no longer
 * this tier's job — kiwi serves those now.
 */
describe("vendoredLogos", () => {
  it("ships the whole snapshot, not a sample", () => {
    expect(vendoredAirlineCount()).toBe(93);
  });

  it("resolves by IATA code", () => {
    const logo = getVendoredLogo("LH", "icon");
    expect(logo).not.toBeNull();
    expect(logo?.contentType).toBe("image/svg+xml");
    expect(logo?.body.toString("utf8")).toContain("<svg");
  });

  it("resolves by ICAO code — bookings often carry only that one", () => {
    const byIcao = getVendoredLogo("DLH", "icon");
    const byIata = getVendoredLogo("LH", "icon");
    expect(byIcao).not.toBeNull();
    expect(byIcao?.body.toString("utf8")).toBe(byIata?.body.toString("utf8"));
  });

  it("is case-insensitive", () => {
    expect(getVendoredLogo("lh", "icon")).not.toBeNull();
  });

  it("serves the icon variant", () => {
    expect(getVendoredLogo("LH", "icon")).not.toBeNull();
  });

  it("serves the monochrome mark for logo-white", () => {
    // Lufthansa ships no icon-mono.svg — its snapshot dir has only icon.svg
    // and logo.svg. Only 22 of 93 airlines ship a monochrome mark; British
    // Airways is one of them, so this is the airline that actually proves the
    // icon-mono.svg mapping resolves a real file.
    expect(getVendoredLogo("BA", "logo-white")).not.toBeNull();
  });

  it("no longer serves wordmarks — the logo variant falls through", () => {
    // The vendored logo.svg was missing for 10 of 93 airlines and its marks
    // needed a plate. kiwi serves this variant now.
    expect(getVendoredLogo("LH", "logo")).toBeNull();
  });

  it("no longer serves tails", () => {
    expect(getVendoredLogo("LH", "tail")).toBeNull();
  });

  it("misses an airline it does not know", () => {
    // American Airlines is genuinely absent from the snapshot (measured against
    // the production data: 14 % of flights fall through to the next tier).
    expect(getVendoredLogo("AA", "icon")).toBeNull();
    expect(getVendoredLogo("ZZZ", "icon")).toBeNull();
  });

  it("refuses a code that tries to escape the asset directory", () => {
    expect(getVendoredLogo("../../../../etc/passwd", "icon")).toBeNull();
    expect(getVendoredLogo("..%2F..%2Fetc", "icon")).toBeNull();
  });
});
