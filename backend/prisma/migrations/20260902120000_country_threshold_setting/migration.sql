-- Which evidence tier the country headline counts from (spec §3.2).
--
-- Two ADDITIVE columns and nothing else: no existing row is rewritten, because
-- nobody's data changes. The setting decides which rows the headline COUNTS,
-- never which countries exist — `foldCountryEvidence` returns every country at
-- every threshold, and `PassportCountry.counted` is what moves.
--
-- admin_settings.country_threshold is NOT NULL with a default: the instance
-- always has a starting point, exactly like beta_features_enabled.
-- user_settings.country_threshold is NULLABLE, and the null means "follow the
-- instance default" rather than "visited" — an account that never opened the
-- setting keeps following the admin instead of freezing today's default.
--
-- Both are TEXT rather than an enum for the reason routing_provider gives:
-- `CountryTier` (shared/countryEvidence.ts) already owns the closed set, Zod
-- validates it at the boundary, and a DB-level enum would be a second place for
-- that list to drift.

-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "country_threshold" TEXT NOT NULL DEFAULT 'visited';

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "country_threshold" TEXT;
