import { cidFromRef, lookupPlaceByCid } from "../googleCidLookup";

/**
 * #358: the CID in a Takeout link is the one identity that cannot land on a
 * namesake, and every way the lookup can fail must come back as its own
 * reason — the preview shows it instead of an empty cell.
 */

const okBody = {
  status: "OK",
  result: {
    name: "Fushimi Inari Taisha",
    types: ["place_of_worship", "tourist_attraction"],
    formatted_address: "68 Fukakusa Yabunouchicho, Kyoto",
    geometry: { location: { lat: 34.9671, lng: 135.7727 } },
    address_components: [
      { long_name: "Kyoto", short_name: "Kyoto", types: ["locality", "political"] },
      { long_name: "Japan", short_name: "JP", types: ["country", "political"] },
    ],
  },
};

const respond = (body: unknown, status = 200): typeof fetch =>
  jest.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("cidFromRef", () => {
  it("reads the decimal CID from the feature id in a Maps link", () => {
    const url =
      "https://www.google.com/maps/place/Fushimi/data=!4m2!3m1!1s0x60010f153d2e6d21:0x7b1aca1c753ae2e9";
    expect(cidFromRef(url)).toBe(BigInt("0x7b1aca1c753ae2e9").toString());
  });

  it("accepts the gmaps: reference the importers mint, and a ?cid= link", () => {
    expect(cidFromRef("gmaps:8870189712345678")).toBe("8870189712345678");
    expect(cidFromRef("gmaps-cid:8870189712345678")).toBe("8870189712345678");
    expect(cidFromRef("https://maps.google.com/?cid=1234567890")).toBe("1234567890");
  });

  it("answers null for a row with no Maps identity", () => {
    expect(cidFromRef(null)).toBeNull();
    expect(cidFromRef("osm:node/42")).toBeNull();
    expect(cidFromRef("https://example.com/place")).toBeNull();
  });
});

describe("lookupPlaceByCid", () => {
  it("returns the exact position, address parts and Google's types", async () => {
    const answer = await lookupPlaceByCid("1", "test-key", respond(okBody));
    expect(answer).toEqual({
      ok: true,
      place: {
        lat: 34.9671,
        lon: 135.7727,
        name: "Fushimi Inari Taisha",
        types: ["place_of_worship", "tourist_attraction"],
        address: "68 Fukakusa Yabunouchicho, Kyoto",
        city: "Kyoto",
        country: "Japan",
        countryCode: "JP",
      },
    });
  });

  it.each([
    ["REQUEST_DENIED", "auth"],
    ["OVER_QUERY_LIMIT", "quota"],
    ["NOT_FOUND", "not_found"],
    ["ZERO_RESULTS", "not_found"],
    ["INVALID_REQUEST", "provider_error"],
  ])("maps Google's status %s to the reason %s", async (status, reason) => {
    const answer = await lookupPlaceByCid("1", "k", respond({ status }));
    expect(answer).toEqual({ ok: false, reason });
  });

  it.each([
    [429, "quota"],
    [403, "auth"],
    [500, "provider_error"],
  ])("maps HTTP %i to the reason %s", async (status, reason) => {
    const answer = await lookupPlaceByCid("1", "k", respond({}, status));
    expect(answer).toEqual({ ok: false, reason });
  });

  it("tells a timeout from a network failure", async () => {
    const timeout = jest.fn(async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    const network = jest.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await lookupPlaceByCid("1", "k", timeout)).toEqual({ ok: false, reason: "timeout" });
    expect(await lookupPlaceByCid("1", "k", network)).toEqual({ ok: false, reason: "network" });
  });

  it("calls an unreadable answer a provider error, not a miss", async () => {
    const answer = await lookupPlaceByCid("1", "k", respond({ status: "OK", result: {} }));
    expect(answer).toEqual({ ok: false, reason: "provider_error" });
  });
});
