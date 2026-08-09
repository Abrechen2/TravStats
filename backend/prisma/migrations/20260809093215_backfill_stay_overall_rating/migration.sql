-- Data-only migration: no schema change.
--
-- `rating_overall` is a CACHE of shared/ratingDerivation.ts, but the deriver
-- used to live in the stay-editor component, so it only ever ran for stays
-- TYPED into that form. Every stay that arrived through the CSV wizard or the
-- e-mail/PDF parser kept a null overall unless its source happened to carry an
-- explicit overall column — and a real hotel sheet scores the parts ("Bew.
-- Zimmer", "Bew. Frühstück") and has no such column. Those stays therefore read
-- as unrated, and every hotel and chain average built on them read "—".
--
-- Recompute the column for every row that has at least one component rating,
-- using the same rule as the deriver: the mean of the components that are
-- present, rounded to the nearest half star. Rows with no component are left
-- alone, which preserves an explicit overall that came from the source (the
-- deriver's `current` fallback) and keeps a genuinely unrated stay unrated.
UPDATE "lodging_stays"
SET "rating_overall" = ROUND(
      (
        (
          COALESCE("rating_room", 0)
          + COALESCE("rating_breakfast", 0)
          + COALESCE("rating_service", 0)
        )::numeric
        / (
          (CASE WHEN "rating_room" IS NULL THEN 0 ELSE 1 END)
          + (CASE WHEN "rating_breakfast" IS NULL THEN 0 ELSE 1 END)
          + (CASE WHEN "rating_service" IS NULL THEN 0 ELSE 1 END)
        )
      ) * 2
    ) / 2
WHERE "rating_room" IS NOT NULL
   OR "rating_breakfast" IS NOT NULL
   OR "rating_service" IS NOT NULL;
