jest.mock("../../instanceSettingsService", () => ({
  resolveGeocoderUrls: jest.fn(),
  DEFAULT_PHOTON_URL: "https://photon.komoot.io",
  DEFAULT_NOMINATIM_URL: "https://nominatim.openstreetmap.org",
}));

import { searchPlacesDetailed } from "../photon";
import { resolveGeocoderUrls } from "../../instanceSettingsService";
import searchTagged from "./fixtures/photon-travemuende/search-tagged.json";
import searchPlace from "./fixtures/photon-travemuende/search-place.json";
import reverseTagged from "./fixtures/photon-travemuende/reverse-tagged.json";

/**
 * Tester report: typing "travemünde" into the ferry form's departure port
 * offered the Priwall river ferry and the Helsinki Vuosaari terminal (its OSM
 * name is "Finnlines Helsinki-Travemünde"), never Skandinavienkai, the port
 * every Baltic ferry from Travemünde uses.
 *
 * The fixtures are the public Photon's real answers, recorded 2026-10-27:
 * the tagged name search, the place search, and the tagged `/reverse` around
 * the Travemünde suburb — the only one of the three that holds the harbour.
 */
const mockResolveGeocoderUrls = resolveGeocoderUrls as jest.Mock;

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

type Route = "tagged" | "place" | "reverse";

function routeOf(url: URL): Route {
  if (url.pathname === "/reverse") return "reverse";
  return url.searchParams.get("osm_tag") === "place" ? "place" : "tagged";
}

const FIXTURES: Record<Route, unknown> = {
  tagged: searchTagged,
  place: searchPlace,
  reverse: reverseTagged,
};

function photon(failing: Route[] = []) {
  const urls: URL[] = [];
  global.fetch = jest.fn(async (raw: string) => {
    const url = new URL(raw);
    urls.push(url);
    const route = routeOf(url);
    return failing.includes(route) ? jsonResponse({}, 503) : jsonResponse(FIXTURES[route]);
  }) as unknown as typeof fetch;
  return urls;
}

describe("ferry port search finds the port of the town typed", () => {
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

  it("puts Skandinavienkai first and Helsinki behind everything in Travemünde", async () => {
    photon();
    const { results, degraded } = await searchPlacesDetailed("travemünde", {
      kind: "ferry_terminal",
    });

    expect(degraded).toBe(false);
    const names = results.map((r) => r.name);
    expect(names[0]).toBe("Skandinavienkai");
    expect(results[0].district).toBe("Travemünde");
    expect(names).toContain("Travemünde Priwallfähre");
    // The Helsinki terminal only MENTIONS the town; it may stay in the list,
    // but never above a hit that lies in Travemünde.
    const helsinki = names.indexOf("Finnlines Helsinki-Travemünde");
    if (helsinki !== -1) {
      const lastInTown = Math.max(
        ...results.map((r, i) => (r.district === "Travemünde" || r.city === "Travemünde" ? i : -1))
      );
      expect(helsinki).toBeGreaterThan(lastInTown);
    }
    // The node and its twin a few metres apart are one terminal.
    expect(names.filter((n) => n === "Travemünde Priwallfähre")).toHaveLength(1);
  });

  it("asks for harbours as well as terminals, by name and around the place", async () => {
    const urls = photon();
    await searchPlacesDetailed("travemünde", { kind: "ferry_terminal" });

    const tagged = urls.filter((u) => routeOf(u) === "tagged");
    const reverse = urls.filter((u) => routeOf(u) === "reverse");
    expect(tagged).toHaveLength(1);
    expect(reverse).toHaveLength(1);
    for (const url of [...tagged, ...reverse]) {
      expect(url.searchParams.getAll("osm_tag")).toEqual([
        "amenity:ferry_terminal",
        "landuse:harbour",
      ]);
    }
    // Centred on the Travemünde suburb the place search named.
    expect(reverse[0].searchParams.get("lat")).toBe("53.9626895");
    expect(reverse[0].searchParams.get("lon")).toBe("10.8759851");
  });

  it("does not centre a search on a fuzzy place match", async () => {
    const urls = photon();
    // The place fixture answers with Travemünde and "Trasmunde" (Spain);
    // neither is the place "trasmund" names, so no reverse lookup runs.
    await searchPlacesDetailed("trasmund", { kind: "ferry_terminal" });
    expect(urls.some((u) => routeOf(u) === "reverse")).toBe(false);
  });

  it.each<Route>(["tagged", "place", "reverse"])(
    "reports the search as unavailable when the %s lookup fails",
    async (route) => {
      photon([route]);
      const { degraded } = await searchPlacesDetailed("travemünde", { kind: "ferry_terminal" });
      expect(degraded).toBe(true);
    }
  );

  it("leaves an ordinary place search a single untagged request", async () => {
    const urls = photon();
    await searchPlacesDetailed("travemünde");
    expect(urls).toHaveLength(1);
    expect(urls[0].searchParams.has("osm_tag")).toBe(false);
  });
});
