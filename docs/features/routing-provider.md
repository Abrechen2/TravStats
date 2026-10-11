# Road routing: setting up a routing provider

TravStats draws a road line for a bus ride (and for roadtrip and tour legs)
only when the instance has a **routing provider**. Without one, every bus ride
is stored and shown as a straight line between its two terminals, labelled
"Luftlinie" / "straight line", and no coordinate ever leaves the server.

This is deliberate: there is no default provider. Choosing one sends the start
and end coordinates of every routed ride to that service, so an administrator
has to opt in.

## What an instance without a provider looks like

- A bus ride keeps `geometrySource = straight` and `distanceSource =
  great_circle`. The statistics show those kilometres on their own line
  ("straight line, where no road was routed") and never add them silently to
  road kilometres.
- The bus form says once: "Ohne Routing-Dienst bleibt es bei der Luftlinie."
  Administrators get a link to the setting, everybody else is told to ask one.
- The logbook and the ride page do not offer "route along the road" (it could
  only fail); they say the same sentence instead.

## Setting one up (administrator)

Open **Administration -> External services -> Routing provider** and choose one
of:

| Provider | What you need | Notes |
|---|---|---|
| OpenRouteService | A free API key from <https://openrouteservice.org/dev/#/signup> | The free plan has a daily request quota; a "route all" pass stops with "quota used up" when it is spent and can be run again the next day. |
| GraphHopper | An API key from <https://www.graphhopper.com/> | Free tier is small; same behaviour at the quota. |
| Custom OSRM | The base URL of your own OSRM server, e.g. `https://osrm.example.com` | Nothing leaves your network. OSRM needs a road extract that covers your rides (a Europe or planet extract for coach travel). |

Save, and the next bus ride you create gets its road line. The key may be set
in the admin settings or, per provider, in the environment
(`OPENROUTESERVICE_API_KEY`, `GRAPHHOPPER_API_KEY`); a provider that is
selected but has no key counts as "not configured" and the form says so.

## What happens when a ride is saved

1. The ride is saved with its two terminals.
2. The server asks the provider once for a road route (6 s timeout, so a
   hanging provider cannot hang the save) and freezes the answer with the ride:
   the line, `geometrySource = road`, and the routed length as `distanceKm`
   with `distanceSource = route`.
3. A distance typed from the ticket (`user`) always wins over the routed length.
4. If the provider does not deliver, the straight line is stored and the save
   answers `meta.geometry.fallback` with one of: `no_provider`,
   `provider_error`, `no_route`, `point_not_near_road`, `rate_limited`, `auth`,
   `untrustworthy`. The form words each one.
5. Editing a ride asks the provider again **only** when a terminal's
   coordinates changed. If that fails, the stored road line stays as long as it
   still reaches both terminals.

## Rides logged before routing existed

Every ride from before the provider was configured is a straight line.

- **One ride:** the ride page has "Über die Straße berechnen" (`POST
  /api/v1/bus/{id}/route`). A ride that already has its line answers
  `outcome: unchanged` without calling the provider.
- **All of them:** the logbook has "Alle Luftlinien-Fahrten über die Straße
  berechnen" (`POST /api/v1/bus/route-straight`), a background job that routes
  up to 200 straight rides, newest first, and reports each ride's outcome with
  the provider's reason. It stops on a quota or key refusal and says how many
  rides are still open.

Both are rate-limited (60 requests per hour and user), refuse the shared demo
account, and only ever touch the caller's own rides.

## Not built yet

The timetable lookup of the bus design (Transitous `stoptimes` with mode
`COACH`, matching operator and line and bringing the coach's own traced line)
is a separate follow-up; road routing is the fallback line for every ride and
the only one outside Europe.
