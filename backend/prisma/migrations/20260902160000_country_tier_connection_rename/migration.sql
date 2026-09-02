-- The country tier vocabulary gains a rung and renames its lowest one.
-- Spec `docs/superpowers/specs/2026-09-02-country-counting-design.md` §3.4c.
--
--   before:  slept > visited > transit
--   after:   slept > visited > transited > connection
--
-- `transited` is a border crossed on the ground — driving through, which the
-- owner confirmed for Estonia and Lithuania. After that split, "transit" is the
-- word a reader attaches to the road case, so the airside rung is renamed
-- `connection`. This runs now rather than later because the value is stored, and
-- a stored vocabulary only gets more expensive to rename.
--
-- The two settings columns hold that vocabulary as plain TEXT. Rewriting them
-- here rather than letting `parseCountryTier` fall back to the default is the
-- whole point: a fallback would silently turn an admin's "everything counts"
-- into "a connection does not", which is a different instance-wide answer.
--
-- The mapping preserves every stored MEANING:
--
--   'transit' -> 'connection'  the bottom rung, renamed. "Everything counts."
--   'visited' -> 'transited'   "everything except the bottom rung". While there
--                              were three rungs that sentence was spelled
--                              `visited`; with four it is spelled `transited`.
--                              Leaving it as `visited` would newly exclude road
--                              crossings from instances that never chose to.
--   'slept'   -> unchanged.
--
-- `visited` remains a legal, and now genuinely different, choice: a road
-- crossing does not count, only a stay does. Nobody is migrated INTO it,
-- because nobody could have meant it before it existed.

ALTER TABLE "admin_settings" ALTER COLUMN "country_threshold" SET DEFAULT 'transited';

UPDATE "admin_settings" SET "country_threshold" = 'connection' WHERE "country_threshold" = 'transit';
UPDATE "admin_settings" SET "country_threshold" = 'transited' WHERE "country_threshold" = 'visited';

UPDATE "user_settings" SET "country_threshold" = 'connection' WHERE "country_threshold" = 'transit';
UPDATE "user_settings" SET "country_threshold" = 'transited' WHERE "country_threshold" = 'visited';
