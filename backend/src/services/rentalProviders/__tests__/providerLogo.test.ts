import fs from "fs/promises";
import { findRentalProvider, rentalProviders } from "../providerCatalog";
import {
  __resetProviderLogoCachesForTests,
  providerLogoCacheDir,
  resolveProviderLogo,
} from "../providerLogoService";

/**
 * forgejo#196: provider logos follow the airline-logo rule — a chain of tiers,
 * each returning null on a miss, and NOTHING when nobody has a logo. The four
 * defect classes are driven here through the failure paths: an unknown
 * provider, a 404, a non-image answer, a thrown network error.
 */
const png = (): Response =>
  new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
    status: 200,
    headers: { "content-type": "image/png" },
  });

describe("rental provider catalogue", () => {
  it("is data: a non-empty list read from data/rental/providers.json", () => {
    const names = rentalProviders().map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Sixt", "Avis", "Europcar", "Hertz"]));
  });

  it("matches a typed provider by name or alias, folding case and punctuation", () => {
    expect(findRentalProvider("SIXT")?.id).toBe("sixt");
    expect(findRentalProvider("Sixt rent-a-car")?.id).toBe("sixt");
    expect(findRentalProvider("car2go")?.id).toBe("share-now");
  });

  it("never guesses: a near name or a local company is no match", () => {
    expect(findRentalProvider("Sixt Leasing")).toBeNull();
    expect(findRentalProvider("Autovermietung Müller")).toBeNull();
    expect(findRentalProvider("")).toBeNull();
    expect(findRentalProvider(null)).toBeNull();
  });
});

describe("resolveProviderLogo (forgejo#196)", () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    __resetProviderLogoCachesForTests();
    await fs.rm(providerLogoCacheDir(), { recursive: true, force: true });
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await fs.rm(providerLogoCacheDir(), { recursive: true, force: true });
  });

  it("asks nobody about a provider that is not catalogued", async () => {
    expect(await resolveProviderLogo("Autovermietung Müller")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes the provider's own site icon first", async () => {
    fetchMock.mockResolvedValueOnce(png());
    const logo = await resolveProviderLogo("Sixt");
    expect(logo?.contentType).toBe("image/png");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://www.sixt.com/apple-touch-icon.png");
  });

  it("falls through a 404 and a non-image to the next tier", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("nope", { status: 404 }))
      .mockResolvedValueOnce(png());
    expect(await resolveProviderLogo("Avis")).not.toBeNull();
    expect(String(fetchMock.mock.calls[1][0])).toContain("icons.duckduckgo.com/ip3/avis.com");

    __resetProviderLogoCachesForTests();
    await fs.rm(providerLogoCacheDir(), { recursive: true, force: true });
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        new Response("<html/>", { status: 200, headers: { "content-type": "text/html" } })
      )
      .mockResolvedValueOnce(
        new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } })
      );
    expect(await resolveProviderLogo("Avis")).toBeNull();
  });

  it("answers null — never a stand-in — when every tier fails, and remembers the miss", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await resolveProviderLogo("Hertz")).toBeNull();
    const calls = fetchMock.mock.calls.length;
    expect(await resolveProviderLogo("Hertz")).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("serves a cached logo without asking again", async () => {
    fetchMock.mockResolvedValueOnce(png());
    await resolveProviderLogo("Europcar");
    fetchMock.mockClear();
    expect(await resolveProviderLogo("europcar")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
