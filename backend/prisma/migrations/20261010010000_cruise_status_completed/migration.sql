-- #357: a sailed cruise is `completed`, not `flown`. The flight word was the
-- column's vocabulary while it was shared; the API, the Excel sheet and every
-- client showed it raw. Data only — the column stays plain TEXT, and `flown`
-- is still accepted on input (read as `completed`), so nothing that sends the
-- old value breaks. Reversible by the inverse UPDATE.
UPDATE "cruises" SET "status" = 'completed' WHERE "status" = 'flown';
