# Companion audit — server side (companion#85, companion#92)

Additive only; the app gates on field presence.

## Contract

1. `GET /api/v1/ferry/stats[?year=&until=MM-DD]` — enveloped `{success, data}`, the sibling of
   `/bus/stats`. `data`: `crossings`, `distance{totalKm,straightLineKm,routeKm,ticketKm: number|null,
   unmeasuredCrossings}`, `hoursOnBoard{hours: number|null, measuredCrossings}`, `countries`,
   `operators`, `ports`, `portsVisited`, `longest|null`, `byYear[{year,crossings,km|null,unmeasured}]`.
   Completed crossings only (`shared/ferryCounting`). Unlike bus, unmeasured is `null`, never 0.
2. `GET /trips/:id` gains `totalDistanceKm: number|null` and `distanceByMode:
   {flight,rail,bus,ferry,cruise,roadtrip}: number|null` (whole km). Each mode counts what its
   domain rule counts (flown flights, completed rail excluding tram/metro, completed bus and
   ferry, counted cruises' legs). `roadtrip` is the road legs only, so a ferry/rail leg linked
   to a journey is not counted twice. Total = sum of the rounded modes; null when every mode is.
3. Trip `countries` (list and detail) also include the countries of place visits linked to the
   trip (`PlaceVisit.tripId`). Same cut as the passport (`passportLoader`): place `visited`,
   visit has happened (`classifyVisit`; undated counts, future does not), resolved
   `isoCountryCode`, and never a transit place (`placeCountsAsTransit`, which the passport files
   as a connection). A user-filled `trips.countries` still wins untouched. Share-link and
   takeout callers of `tripCountries` are unchanged on purpose (the share view should not
   publish places; the takeout matcher must not match a place against its own trip).
4. `GET /stats/insights/roadtrips`: `totals.roadtripsCount = {allTime, byYear}` by the rule of the
   roadtrips tile (`roadtripCountsIn`): started roadtrips; year of start; undated only lifetime.

Minimum server version: the release that carries this branch.
