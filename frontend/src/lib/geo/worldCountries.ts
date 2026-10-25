import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";

/**
 * The world's country shapes the frontend ships itself (`public/countries-110m.json`,
 * Natural Earth 1:110m) — same origin, no third-party request. Loaded once per
 * page and shared by the globe loader and the Track map's countries layer; a
 * failed load is not remembered, so the next caller asks again.
 */

type Cache =
  | { status: "pending"; promise: Promise<FeatureCollection<Geometry>> }
  | { status: "ready"; data: FeatureCollection<Geometry> }
  | null;

let cache: Cache = null;

export async function loadWorldCountries(): Promise<FeatureCollection<Geometry>> {
  if (cache?.status === "ready") return cache.data;
  if (cache?.status === "pending") return cache.promise;
  const promise = fetch("/countries-110m.json")
    .then((r) => {
      if (!r.ok) throw new Error(`countries topojson: HTTP ${r.status}`);
      return r.json() as Promise<Topology<{ countries: GeometryCollection }>>;
    })
    .then((world) => {
      const fc = feature(world, world.objects.countries) as unknown as FeatureCollection<Geometry>;
      cache = { status: "ready", data: fc };
      return fc;
    })
    .catch((err: unknown) => {
      cache = null;
      throw err;
    });
  cache = { status: "pending", promise };
  return promise;
}
