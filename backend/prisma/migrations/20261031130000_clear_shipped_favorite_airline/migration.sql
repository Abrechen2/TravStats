-- forgejo#389: defaults.favoriteAirline used to ship as "Lufthansa" and did
-- nothing. It now prefills new flights, so a stored "Lufthansa" that nobody
-- chose must go. Only the exact shipped value is removed; any other airline is
-- a choice and stays. Idempotent: a second run matches no row.
UPDATE "user_settings"
   SET "data" = "data" #- '{defaults,favoriteAirline}'
 WHERE "data" -> 'defaults' ->> 'favoriteAirline' = 'Lufthansa';
