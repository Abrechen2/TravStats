-- The §8.2 signal: how many of a country-day's points sat at an airport this
-- account is known to have flown through.
--
-- "A GPS point in Doha is still a point in Qatar even if you never left the
-- terminal." Location history cannot tell a connection from a visit on its own;
-- it can when the flights are read beside it. The test has to happen while the
-- positions are still in memory — `services/countryDays/reduce.ts` discards
-- every coordinate before a row is written — so this cannot be derived later
-- and has to be a column.
--
-- DEFAULT 0 for rows written before it existed. Zero says "nothing was airside",
-- which errs towards the stronger tier: a country stays in the headline rather
-- than dropping out of it, the safe direction for an inferred hint. The next
-- sweep of a month rewrites its rows anyway (`replaceCountryDays`).

ALTER TABLE "country_days" ADD COLUMN "airport_point_count" INTEGER NOT NULL DEFAULT 0;
