# Demo account geometry — sources and licences

The two files in this folder hold the road and trail geometry of the demo
account (`seedDemoAccount.ts`). They are generated once, with the network, by
`backend/scripts/demo/generateDemoGeometry.ts`, and read by the seed without
it — the seed runs on first boot, possibly offline.

| File | Content | Generated from |
|---|---|---|
| `roadtrip-legs.json.gz` | 43 routed roadtrip legs (car profile), simplified to ~30 m; 2 ferry crossings drawn by hand | FOSSGIS OSRM, `routing.openstreetmap.de/routed-car` |
| `tour-tracks.json.gz` | 10 recorded tracks (hikes and a four-day cycle tour): every point with elevation and a time since the start | path: BRouter, `brouter.de` (`hiking-mountain`, `trekking`); elevation: Open-Meteo Elevation API, `api.open-meteo.com/v1/elevation` |

Coordinates of the hotels, campsites and huts the routes connect were looked
up with Nominatim (`nominatim.openstreetmap.org`) on 2026-09-26 and are
written into `backend/src/seedDemo/realistic/data/`.

## Licences

- **Route geometry** is derived from OpenStreetMap data,
  © OpenStreetMap contributors, available under the
  [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  See <https://www.openstreetmap.org/copyright>.
- **Elevation** on the tracks comes from the Open-Meteo Elevation API
  (<https://open-meteo.com/en/docs/elevation-api>), which serves the Copernicus
  DEM GLO-90: © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH
  2014-2018, provided under COPERNICUS by the European Union and ESA; the
  API's data is licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  BRouter's own elevation values are discarded, so one source serves every
  profile. Open-Meteo's free tier limits requests per minute and per hour;
  the generator waits the limit out rather than switching sources.
- **Times** on the tracks are not recorded: the generator derives them from
  distance and grade (Tobler's hiking function for walks, a touring-bike
  speed model for rides) and inserts the pauses listed in `routeSpecs.ts`.
  They are plausible, not measured, and nobody's real recording.

## Regenerating

```bash
cd backend
npx tsx scripts/demo/generateDemoGeometry.ts            # post-process from the cache
npx tsx scripts/demo/generateDemoGeometry.ts --refetch  # ask the routers again
```

The raw router answers are cached in `backend/scripts/demo/.cache/`
(gitignored). The public services are run by volunteers: the script pauses
between requests and asks each question once.
