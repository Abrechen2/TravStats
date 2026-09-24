import { z } from "zod";

import { haversineKm } from "../../shared/geo/haversine";
import { namesCouldBeOneHouse } from "../lodging/nameSimilarity";
import { fetchOpenDataJson } from "./http";

/**
 * OpenStreetMap as a source of facts about a place TravStats already located:
 * its tags (a Wikidata item, a website, stars, the chain it belongs to).
 * ODbL; OpenStreetMap is credited under Settings → About.
 */

const OSM_REF = /^osm:(node|way|relation)\/(\d+)$/;

const elementSchema = z.object({
  elements: z.array(z.object({ tags: z.record(z.string(), z.string()).optional() })).min(1),
});

/** The tags of the OSM element a place was picked from ("osm:node/240109189"). */
export async function osmTagsOf(
  externalRef: string | null
): Promise<Record<string, string> | null> {
  const match = externalRef?.match(OSM_REF);
  if (!match) return null;
  const [, type, id] = match;
  const parsed = elementSchema.safeParse(
    await fetchOpenDataJson("osm-api", `https://api.openstreetmap.org/api/0.6/${type}/${id}.json`)
  );
  return parsed.success ? (parsed.data.elements[0].tags ?? {}) : null;
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
/** How far from the stored pin the house may stand. A pin from a booking mail is rarely exact. */
const SEARCH_RADIUS_M = 150;
const LODGING_TOURISM =
  "hotel|guest_house|hostel|motel|apartment|chalet|camp_site|caravan_site|alpine_hut";

const overpassSchema = z.object({
  elements: z.array(
    z.object({
      type: z.string(),
      id: z.number(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      center: z.object({ lat: z.number(), lon: z.number() }).optional(),
      tags: z.record(z.string(), z.string()).optional(),
    })
  ),
});

export interface OsmLodging {
  osmRef: string;
  name: string;
  tags: Record<string, string>;
  distanceM: number;
}

/**
 * The OpenStreetMap entry of a house: a lodging-type feature within
 * `SEARCH_RADIUS_M` of its pin whose name could be the same house.
 *
 * The name has to agree. The nearest hotel alone is a guess — two houses share
 * a street corner often enough — and a stranger's stars written into the
 * user's record would be a silent error. Of several that agree, the nearest.
 */
export async function findOsmLodging(
  lat: number,
  lon: number,
  name: string
): Promise<OsmLodging | null> {
  const query =
    `[out:json][timeout:15];` +
    `nwr(around:${SEARCH_RADIUS_M},${lat},${lon})["tourism"~"^(${LODGING_TOURISM})$"]["name"];` +
    `out tags center 25;`;
  const parsed = overpassSchema.safeParse(
    await fetchOpenDataJson("overpass", OVERPASS_URL, { form: { data: query }, timeoutMs: 20_000 })
  );
  if (!parsed.success) return null;

  const candidates = parsed.data.elements.flatMap((el) => {
    const at =
      el.center ?? (el.lat != null && el.lon != null ? { lat: el.lat, lon: el.lon } : null);
    const osmName = el.tags?.name;
    if (!at || !osmName || !namesCouldBeOneHouse(name, osmName, true)) return [];
    return [
      {
        osmRef: `osm:${el.type}/${el.id}`,
        name: osmName,
        tags: el.tags ?? {},
        distanceM: Math.round(haversineKm({ lat, lon }, at) * 1000),
      },
    ];
  });
  return [...candidates].sort((a, b) => a.distanceM - b.distanceM)[0] ?? null;
}
