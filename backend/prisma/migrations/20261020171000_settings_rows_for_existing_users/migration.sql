-- Hand-written (forgejo#321): the settings level of 20261020170000 reached every
-- account WITH a user_settings row. An account without one — signed up, never
-- loaded its settings since rows existed — would get its row from the first
-- GET /settings, at the new default 'standard', although it existed before the
-- redesign. This gives each such account its row now, at 'expert'.
--
-- The row is what that GET would have created: the same JSON blob as
-- `defaultSettings` (routes/settings/types.ts) and every other column at its
-- database default. Replayed by src/__tests__/migration.userSettingsLevel.test.ts,
-- which also compares the blob with `defaultSettings`.
INSERT INTO "user_settings" ("id", "user_id", "data", "settings_level", "updated_at")
SELECT gen_random_uuid()::text,
       u."id",
       '{"profile": {"username": "Traveler", "email": "traveler@example.com", "profilePicture": null}, "display": {"theme": "light", "timeFormat": "24h"}, "units": {"distanceUnit": "kilometers", "currency": "EUR"}, "defaults": {"flightStatus": "scheduled", "seatClass": "", "favoriteAirline": "Lufthansa", "flightCategory": ""}, "map": {"mapStyle": "osm", "zoomLevel": 3, "markerStyle": "pin", "routeColor": "#2563eb"}, "notifications": {"emailNotifications": true, "flightReminder": "24h", "checkInReminder": true, "featureUpdates": true}}'::jsonb,
       'expert',
       CURRENT_TIMESTAMP
FROM "users" u
WHERE NOT EXISTS (SELECT 1 FROM "user_settings" s WHERE s."user_id" = u."id");
