import {
  contains,
  validateAreas,
  type MarketArea,
  type Position,
  type Ring,
  type Polygon,
} from "./geometry";
import { venueType, type VenueType } from "./venueTypes";
export interface PointMarket {
  id: string;
  name: string;
  sourceUrl: string;
  entityRef?: string;
  venueType?: VenueType;
}
export interface MarketCatalog {
  areas: MarketArea[];
  missingAreas: PointMarket[];
  invalidCount: number;
  sourceTimestamp: string | null;
}
type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue => !!v && typeof v === "object" && !Array.isArray(v);
function coordinates(raw: unknown): Position[] {
  if (!Array.isArray(raw) || raw.length > 20000) throw new Error("geometry");
  return raw.map((v) => {
    if (
      !record(v) ||
      typeof v.lat !== "number" ||
      typeof v.lon !== "number" ||
      !Number.isFinite(v.lat) ||
      !Number.isFinite(v.lon) ||
      Math.abs(v.lat) > 90 ||
      Math.abs(v.lon) > 180
    )
      throw new Error("coordinate");
    return [v.lon, v.lat] as Position;
  });
}
const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
/** Stitch relation fragments; never replace missing boundaries with a convex hull. */
function rings(parts: Position[][]): Ring[] {
  const remaining = parts.map((p) => [...p]);
  const result: Ring[] = [];
  while (remaining.length) {
    let line = remaining.pop()!;
    if (line.length < 2) throw new Error("fragment");
    while (!same(line[0], line[line.length - 1])) {
      const tail = line[line.length - 1];
      const i = remaining.findIndex((p) => same(p[0], tail) || same(p[p.length - 1], tail));
      if (i < 0) throw new Error("incomplete relation");
      let next = remaining.splice(i, 1)[0];
      if (!same(next[0], tail)) next = next.reverse();
      line = line.concat(next.slice(1));
      if (line.length > 20000) throw new Error("large relation");
    }
    if (line.length < 4) throw new Error("ring");
    result.push(line);
  }
  return result;
}
function geometry(e: RecordValue): MarketArea["geometry"] {
  if (e.type === "way") {
    const ring = coordinates(e.geometry);
    if (ring.length < 4 || !same(ring[0], ring[ring.length - 1])) throw new Error("open way");
    return { type: "Polygon", coordinates: [ring] };
  }
  if (e.type !== "relation" || !Array.isArray(e.members) || e.members.length > 1000)
    throw new Error("relation");
  const outer: Position[][] = [],
    inner: Position[][] = [];
  for (const raw of e.members) {
    if (!record(raw)) throw new Error("member");
    if (raw.type === "node") continue;
    if (raw.type !== "way" || !["outer", "inner", ""].includes(String(raw.role ?? "")))
      throw new Error("unsupported member");
    (raw.role === "inner" ? inner : outer).push(coordinates(raw.geometry));
  }
  const out = rings(outer);
  if (!out.length) throw new Error("outer");
  const result: Polygon[] = out.map((r) => [r]);
  for (const hole of rings(inner)) {
    const owners = out.flatMap((ring, i) =>
      contains(
        {
          id: "ring",
          name: "ring",
          sourceUrl: "https://openstreetmap.org",
          geometry: { type: "Polygon", coordinates: [ring] },
        },
        hole[0][0],
        hole[0][1]
      )
        ? [i]
        : []
    );
    if (owners.length !== 1) throw new Error("orphan hole");
    result[owners[0]] = [...result[owners[0]], hole];
  }
  return { type: "MultiPolygon", coordinates: result };
}
export function parseMarketCatalog(raw: unknown, includeVenues = false): MarketCatalog {
  if (!record(raw) || !Array.isArray(raw.elements) || raw.elements.length > 3000 || raw.remark)
    throw new Error("Incomplete Overpass response");
  const areas: MarketArea[] = [],
    missingAreas: PointMarket[] = [];
  let invalidCount = 0;
  const seen = new Set<string>();
  for (const value of raw.elements) {
    if (
      !record(value) ||
      !["node", "way", "relation"].includes(String(value.type)) ||
      !Number.isSafeInteger(value.id)
    )
      continue;
    const tags = record(value.tags) ? value.tags : {};
    const english = typeof tags["name:en"] === "string" ? tags["name:en"] : "";
    const name = (english || (typeof tags.name === "string" ? tags.name : "")).trim().slice(0, 200);
    const type = venueType(tags);
    if (!name || !type || (!includeVenues && type !== "market")) continue;
    const id = `${value.type}/${value.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const base = {
      id,
      name,
      ...(type !== "market" ? { venueType: type } : {}),
      sourceUrl: `https://www.openstreetmap.org/${id}`,
      ...(typeof tags.wikidata === "string" && /^Q[1-9][0-9]*$/.test(tags.wikidata)
        ? { entityRef: `wikidata:${tags.wikidata}` }
        : {}),
    };
    if (value.type === "node") {
      missingAreas.push(base);
      continue;
    }
    try {
      const area = { ...base, geometry: geometry(value) };
      validateAreas([area]);
      areas.push(area);
    } catch {
      invalidCount++;
    }
  }
  const meta = record(raw.osm3s) ? raw.osm3s : {};
  return {
    areas,
    missingAreas,
    invalidCount,
    sourceTimestamp: typeof meta.timestamp_osm_base === "string" ? meta.timestamp_osm_base : null,
  };
}
