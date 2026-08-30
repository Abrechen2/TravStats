jest.mock("../../instanceSettingsService", () => ({
  resolveGeocoderUrls: jest.fn(),
  DEFAULT_PHOTON_URL: "https://photon.komoot.io",
  DEFAULT_NOMINATIM_URL: "https://nominatim.openstreetmap.org",
}));

import { searchPlaces } from "../photon";
import { resolveGeocoderUrls } from "../../instanceSettingsService";

const mockResolveGeocoderUrls = resolveGeocoderUrls as jest.Mock;

/**
 * POI Phase D §3.1. `Place` carries `@@unique([userId, externalRef])` to stop
 * the same place existing twice, and nothing minted a value for it: a place
 * added by hand through the picker was stored with `externalRef: null`, so the
 * index could never fire. Add the Colosseum by hand, import it later from
 * Google Takeout as `gmaps:<cid>`, and you own two Colosseums.
 *
 * Photon has always returned `osm_type`/`osm_id`; the schema simply did not
 * read them.
 */
function photonResponse(properties: Record<string, unknown>): string {
  return JSON.stringify({
    features: [
      {
        properties: { name: "Colosseo", ...properties },
        geometry: { coordinates: [12.49, 41.89] },
      },
    ],
  });
}

function mockFetchOnce(body: string): void {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => body,
  })) as unknown as typeof fetch;
}

describe("a search hit carries its OSM identity", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    mockResolveGeocoderUrls.mockResolvedValue({
      photonUrl: "https://photon.komoot.io",
      nominatimUrl: "https://nominatim.openstreetmap.org",
    });
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  it("mints osm:<type>/<id> from the feature", async () => {
    mockFetchOnce(photonResponse({ osm_type: "R", osm_id: 1834818 }));
    const results = await searchPlaces("colosseo");
    expect(results[0].externalRef).toBe("osm:relation/1834818");
  });

  it("writes the long form, whichever spelling Photon sends", async () => {
    // An identity that changes shape when the geocoder changes its
    // abbreviation is not an identity: every row minted under the old spelling
    // would quietly stop matching, and the duplicates would come back.
    mockFetchOnce(photonResponse({ osm_type: "relation", osm_id: "1834818" }));
    const results = await searchPlaces("colosseo");
    expect(results[0].externalRef).toBe("osm:relation/1834818");
  });

  it("leaves it undefined when the hit names no identity", async () => {
    // Honest absence. A coordinate with no source is not identifiable, and a
    // made-up ref would be worse than none — it would collide with a real one.
    mockFetchOnce(photonResponse({}));
    const results = await searchPlaces("colosseo");
    expect(results[0].externalRef).toBeUndefined();
    expect(results[0].name).toBe("Colosseo");
  });

  it("refuses a half-present identity rather than inventing the missing half", async () => {
    mockFetchOnce(photonResponse({ osm_type: "N" }));
    const results = await searchPlaces("colosseo");
    expect(results[0].externalRef).toBeUndefined();
  });
});
