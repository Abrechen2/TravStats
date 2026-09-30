# Demo account geometry — sources and licences

The three files in this folder hold the road, trail and rail geometry of the
demo account (`seedDemoAccount.ts`). They are generated once, with the
network, by `backend/scripts/demo/generateDemoGeometry.ts` (roads, trails) and
`backend/scripts/demo/generateDemoRailGeometry.ts` (rail), and read by the
seed without it — the seed runs on first boot, possibly offline.

| File | Content | Generated from |
|---|---|---|
| `roadtrip-legs.json.gz` | 43 routed roadtrip legs (car profile), simplified to ~30 m; 2 ferry crossings drawn by hand | FOSSGIS OSRM, `routing.openstreetmap.de/routed-car` |
| `rail-lines.json.gz` | 23 train lines, one per station pair of the 44 train rides (a ride in the other direction reads its pair's line reversed), simplified to ~20 m, with the routed length | BRouter, `brouter.de`, profile `rail` (the OSM railway network), through the via points in `data/railRoutes.ts` |
| `tour-tracks.json.gz` | 10 recorded tracks (hikes and a four-day cycle tour): every point with elevation and a time since the start | path: BRouter, `brouter.de` (`hiking-mountain`, `trekking`); elevation: Open-Meteo Elevation API, `api.open-meteo.com/v1/elevation` |

Coordinates of the hotels, campsites and huts the routes connect were looked
up with Nominatim (`nominatim.openstreetmap.org`) on 2026-09-26 and are
written into `backend/src/seedDemo/realistic/data/`.

## Licences

- **Route geometry** is derived from OpenStreetMap data,
  © OpenStreetMap contributors, available under the
  [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  See <https://www.openstreetmap.org/copyright>.
- **Rail lines** are routed over OpenStreetMap's railway network and are the
  likely path of each train, not a timetable trace: the seed stores them as
  `geometrySource: "brouter"` and the app labels them "routed over the rail
  network, not from a timetable". The public OpenRailRouting instance
  (`routing.openrailrouting.org`) would be the natural source, but it
  publishes no terms for scripted use (its "Terms" link is GraphHopper's
  commercial API terms), so the generator uses BRouter, which the tour tracks
  already come from. brouter.de cuts long requests off, so each line is asked
  stretch by stretch between its via points. Via points near Shin-Yokohama and
  Shin-Osaka were replaced by Shinagawa/Kawasaki and Takatsuki/Ōsaka: the
  station points snapped to tracks that left the corridor and came back
  100–170 km longer (measured 2026-09-27).
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
npx tsx scripts/demo/generateDemoRailGeometry.ts         # rail lines, same cache rules
```

The raw router answers are cached in `backend/scripts/demo/.cache/`
(gitignored). The public services are run by volunteers: the script pauses
between requests and asks each question once.
