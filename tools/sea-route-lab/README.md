# sea-route-lab

Visual test-bench for comparing sea- and river-route rendering methods
side by side. Standalone Vite app — **not integrated into TravStats**,
does not ship in production builds.

## Run

```bash
cd tools/sea-route-lab
npm install       # first time only
npm run dev       # http://localhost:8010
```

The Vite dev server auto-serves the backend's land-mask binaries at
`/land-mask-*.bin` via a tiny middleware in `vite.config.ts`. No
symlinks or copies — it reads straight off disk at
`../../backend/data/land-mask-<res>deg.bin`.

## Routing methods compared

| Method              | Idea                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| Great-circle        | 128-point spherical geodesic. No land check — baseline.               |
| Bezier (fallback)   | Quadratic Bezier with pole-biased perpendicular offset.               |
| A* 0.1° raster      | Status-quo: Natural-Earth land mask, 11 km cells, cell-center path.   |
| A* 0.1° + Chaikin   | Same A*, plus 2 iterations of Chaikin corner-cutting.                 |
| A* 0.1° + Catmull-Rom | Same A*, interpolated through a Catmull-Rom spline (off by default). |
| A* 0.05° raster     | Finer raster (~5.5 km cells, 3.2 MB data, 4× compute).                |
| Waypoint graph      | 26 hand-curated maritime checkpoints + Dijkstra, sphere-sampled.      |

## Port-pair presets

- Hamburg ↔ Copenhagen — inland port + Baltic via Øresund
- Barcelona ↔ Civitavecchia — Mediterranean
- Miami ↔ Nassau — short Caribbean
- Sydney ↔ Auckland — open ocean
- Hamburg ↔ New York — transatlantic
- Rotterdam ↔ Singapore — global, Suez + Bab-el-Mandeb + Malacca

## Generating new raster resolutions

```bash
npx tsx scripts/generate-mask.ts --res 0.05   # 3.2 MB, ~5.5 km
npx tsx scripts/generate-mask.ts --res 0.02   # 19 MB, ~2.2 km (impractical)
```

The cached Natural Earth 10 m GeoJSON in `backend/data/.cache/` is
reused automatically.
