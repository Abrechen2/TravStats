-- GitHub #403 — one storage convention for a date-only flight end.
--
-- The contract (forgejo#273, shared/time/dateOnlyFlights.json) is: a DATE_ONLY
-- end is the instant of a LOCAL wall clock (the form's noon) in the end's zone,
-- and its day is the local day of that instant. Rows written as midnight UTC
-- ("2025-12-28T00:00:00Z") are the other convention: read through a zone west
-- of UTC they land on the previous day.
--
-- A row is in the old shape when it is DATE_ONLY, sits exactly on 00:00:00 UTC
-- and its zone's clock at that instant is neither 00:00 nor 12:00 — those two
-- are what the current writers produce (offsets 0 and +12 coincide with them
-- and are already right). It becomes noon of the same calendar date in its
-- zone. Rows without a stored zone, or with a zone Postgres does not know, are
-- left alone: no zone, no honest conversion. (CASE, not AND: Postgres does not
-- short-circuit AND, and an unknown zone name would abort the whole migration.) No schema change.

UPDATE flights
   SET departure_time = ((departure_time::date + TIME '12:00') AT TIME ZONE dep_timezone) AT TIME ZONE 'UTC'
 WHERE dep_time_semantics = 'DATE_ONLY'
   AND departure_time IS NOT NULL
   AND departure_time::time = TIME '00:00'
   AND dep_timezone IS NOT NULL
   AND CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = dep_timezone)
            THEN ((departure_time AT TIME ZONE 'UTC') AT TIME ZONE dep_timezone)::time NOT IN (TIME '00:00', TIME '12:00')
            ELSE FALSE END;

UPDATE flights
   SET arrival_time = ((arrival_time::date + TIME '12:00') AT TIME ZONE arr_timezone) AT TIME ZONE 'UTC'
 WHERE arr_time_semantics = 'DATE_ONLY'
   AND arrival_time IS NOT NULL
   AND arrival_time::time = TIME '00:00'
   AND arr_timezone IS NOT NULL
   AND CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = arr_timezone)
            THEN ((arrival_time AT TIME ZONE 'UTC') AT TIME ZONE arr_timezone)::time NOT IN (TIME '00:00', TIME '12:00')
            ELSE FALSE END;
