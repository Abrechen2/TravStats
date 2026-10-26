# Rail routing: OpenRailRouting for trains, trams and U-Bahn

TravStats draws a rail ride with the train's own timetable trace (Transitous)
when it has one. Without a trace, and only where an administrator configured a
self-hosted [OpenRailRouting](https://github.com/geofabrik/OpenRailRouting)
(Administration -> External services -> Rail router), the line is routed over
the OpenStreetMap track network between the stations. A ride that cannot be
routed keeps the straight line, labelled as such, with the reason beside it.

## Which network a ride is routed over

Every ride carries a transit mode, and each mode is routed over its own
tracks only:

| Ride                        | Profile asked                                      | Tracks (`railway_class`) |
| --------------------------- | -------------------------------------------------- | ------------------------ |
| Train (`rail`, the default) | `all_tracks`, restricted by a request custom model | RAIL, NARROW_GAUGE       |
| Tram                        | `tram`                                             | TRAM, LIGHT_RAIL         |
| U-Bahn (`metro`)            | `subway`                                           | SUBWAY, LIGHT_RAIL       |

Every answer is checked against those classes; a line that runs over anything
else is refused rather than stored.

Until 2026-10-26 every ride was routed as a train, so a tram or U-Bahn ride
either found no route or was drawn over mainline or S-Bahn track. See
[Repairing old tram and U-Bahn lines](#repairing-old-tram-and-u-bahn-lines).

### When the instance has no `tram` or `subway` profile

TravStats then asks `all_tracks` with `"ch.disable": true` and a request custom
model that keeps the route on the mode's classes, e.g. for a tram:

```json
{
  "priority": [
    { "if": "!(railway_class == TRAM || railway_class == LIGHT_RAIL)", "multiply_by": "0" }
  ]
}
```

That works on an instance that accepts non-CH requests (trains are routed the
same way, so an instance that routes trains usually takes it too). An instance
that refuses it leaves the ride straight with the reason "the rail router
cannot route tram and U-Bahn rides over their own network". A tram is never
routed over plain `all_tracks`: a wrong line is worse than an honest straight
one.

The connection test in the admin card says whether `tram` and `subway` exist.

## Adding the `tram` and `subway` profiles (administrator)

Dedicated profiles are faster (they can be CH-prepared) and do not depend on
the instance accepting request custom models.

1. Add both profiles to `config.yml` under `graphhopper.profiles`. The custom
   models are inline, so no extra JSON files are needed:

   ```yaml
   - name: tram
     turn_costs:
       vehicle_types: [tram, light_rail]
       u_turn_costs: 180
       enable_uturn_times: true
     custom_model:
       distance_influence: 0
       priority:
         - if: "!rail_access"
           multiply_by: "0"
         - else_if: "railway_class == TRAM || railway_class == LIGHT_RAIL"
           multiply_by: "1"
         - else: ""
           multiply_by: "0"
       speed:
         - if: "true"
           limit_to: "rail_average_speed"
   - name: subway
     turn_costs:
       vehicle_types: [subway, light_rail]
       u_turn_costs: 180
       enable_uturn_times: true
     custom_model:
       distance_influence: 0
       priority:
         - if: "!rail_access"
           multiply_by: "0"
         - else_if: "railway_class == SUBWAY || railway_class == LIGHT_RAIL"
           multiply_by: "1"
         - else: ""
           multiply_by: "0"
       speed:
         - if: "true"
           limit_to: "rail_average_speed"
   ```

2. List both under `graphhopper.profiles_ch`, so they are fast:

   ```yaml
   - profile: tram
   - profile: subway
   ```

3. Delete the graph cache and re-import: GraphHopper refuses to load a graph
   cache built for a different set of profiles. Stop the service, remove the
   graph-cache directory, start it again and let the import finish.

4. In TravStats, press **Test connection**. It names the `all_tracks` profile
   and says that `tram` and `subway` are present.

## Repairing old tram and U-Bahn lines

Lines are resolved once and frozen with the ride, so rides routed before the
fix keep their mainline line until they are routed again:

- **One ride:** the ride's page has **Route again**. It asks the ride's own
  network afresh. A better line replaces the old one; when the ride's network
  answers that there is no such route, or the instance cannot route the mode
  at all, the old (train-routed) line is dropped for the straight one and the
  reason is shown; when the router is merely down, the old line is kept.
- **The whole instance (administrators):** Administration -> External services
  -> Rail router -> **Route tram and U-Bahn rides again**. It routes every tram
  and U-Bahn ride whose line came from OpenRailRouting, for every user, as a
  background job, and reports how many were routed, reset to straight, kept or
  skipped. It stops early, naming how many are left, if the router stops
  answering; starting it again is safe. The same job can be started with
  `POST /api/v1/admin/instance-settings/rail-routing/reroute-local-transit`
  (admin session; answers `202 { "jobId" }`, poll `GET /api/v1/jobs/{jobId}`;
  `409` with code `notConfigured` without a router, `alreadyRunning` while
  another administrator's pass runs).

Run the instance-wide pass once after adding the profiles.
