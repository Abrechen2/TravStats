-- AlterTable
ALTER TABLE "device_push" ADD COLUMN     "token_rejected_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "reminder_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lead_hours" INTEGER[] DEFAULT ARRAY[24, 2]::INTEGER[],
    "channel" TEXT NOT NULL DEFAULT 'both',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_claims" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "lead_hours" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "anchor_at" TIMESTAMP(3) NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "reminder_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reminder_preferences_user_id_domain_key" ON "reminder_preferences"("user_id", "domain");

-- CreateIndex
CREATE INDEX "reminder_claims_anchor_at_idx" ON "reminder_claims"("anchor_at");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_claims_user_id_domain_entry_id_lead_hours_channel_key" ON "reminder_claims"("user_id", "domain", "entry_id", "lead_hours", "channel");

-- AddForeignKey
ALTER TABLE "reminder_preferences" ADD CONSTRAINT "reminder_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_claims" ADD CONSTRAINT "reminder_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (idempotent: ON CONFLICT DO NOTHING, so a re-run changes nothing).
-- Every account gets one row per domain that says what it gets today:
--   mail  : a notification e-mail address AND the matching switch (lodging
--           follows the 24 h switch only, as the old job did);
--   app   : a paired device with its reminder switch on (flights pushed before;
--           the other domains now do, because the Companion stops scheduling
--           its own reminders once the server pushes);
--   leads : the e-mail switches (24 / 2), else the presets for an app-only row.
-- Nothing is switched on that was off: a row with neither channel is stored
-- disabled. A user created later has no row and is read through the same rule
-- in reminders/prefs.ts.
INSERT INTO "reminder_preferences" ("id", "user_id", "domain", "enabled", "lead_hours", "channel", "updated_at")
SELECT
  gen_random_uuid()::text,
  u."id",
  d."domain",
  (mail.on OR app.on),
  CASE
    WHEN mail.on THEN
      array_remove(ARRAY[
        CASE WHEN u."notify_before_24h" THEN 24 END,
        CASE WHEN u."notify_before_2h" AND d."domain" <> 'lodging' THEN 2 END
      ], NULL)
    ELSE ARRAY[24, 2]
  END,
  CASE WHEN mail.on AND app.on THEN 'both' WHEN app.on THEN 'app' ELSE 'mail' END,
  CURRENT_TIMESTAMP
FROM "users" u
CROSS JOIN (VALUES ('flight'), ('cruise'), ('rail'), ('bus'), ('ferry'), ('lodging')) AS d("domain")
CROSS JOIN LATERAL (
  SELECT (u."notification_email" IS NOT NULL AND (
    u."notify_before_24h" OR (u."notify_before_2h" AND d."domain" <> 'lodging')
  )) AS on
) AS mail
CROSS JOIN LATERAL (
  SELECT EXISTS (
    SELECT 1 FROM "device_push" p WHERE p."user_id" = u."id" AND p."reminders"
  ) AS on
) AS app
ON CONFLICT ("user_id", "domain") DO NOTHING;
