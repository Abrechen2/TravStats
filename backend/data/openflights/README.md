# OpenFlights vendored data

- `airlines.dat`, `planes.dat` — from https://github.com/jpatokal/openflights
  (`data/` dir), Open Database License (ODbL).
- Format `airlines.dat` (headerless CSV, `\N` = null):
  AirlineID, Name, Alias, IATA, ICAO, Callsign, Country, Active("Y"/"N")
- Format `planes.dat` (headerless CSV): Name, IATA, ICAO
- Seeded by `backend/src/data/openflights/*`. Refresh by re-downloading; the
  seeders are idempotent and curated data always wins on conflict.
