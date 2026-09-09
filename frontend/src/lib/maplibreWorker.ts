// Tell MapLibre where its worker lives, because the bundler cannot find out.
//
// MapLibre 6 is ESM-only and resolves its worker itself, with
// `new URL(`./${name}`, import.meta.url)` — a TEMPLATE, so Vite cannot
// statically analyse it and never emits the file. What then happens is the
// worst shape a failure can have: `new Worker()` points at a path that does
// not exist, MapLibre swallows the result, and the map loads its style, sizes
// its canvas, attaches its handlers — and draws NOTHING. No console error, no
// exception, no failed request in the network panel, and every unit test stays
// green because none of them paint. Measured on 2026-09-09 while moving from
// maplibre-gl 5.24 to 6.9 (the 5.24 line carries a CVSS-10 XSS, GHSA-jrc7-96c5-q579,
// with no 5.x patch): the isolated page went from "style fetched, zero tiles
// requested, black canvas" to `isStyleLoaded === true` the moment the worker
// file sat next to the bundle.
//
// `?worker&url` is the idiom that survives this: Vite bundles the worker WITH
// its own imports (the worker entry imports maplibre's shared chunk, so a bare
// `?url` would emit one file whose relative import 404s) and hands back the
// emitted URL, hashed and served from the same origin.
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(maplibreWorkerUrl);
