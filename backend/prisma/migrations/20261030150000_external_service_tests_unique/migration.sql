-- One verdict per (account, service) and one per service for the instance.
-- Keep the newest row of each scope before the indexes go on: the table was
-- written by delete-then-create and a concurrent first test could leave two.
DELETE FROM "external_service_tests" a
USING "external_service_tests" b
WHERE a."service_id" = b."service_id"
  AND a."user_id" IS NOT DISTINCT FROM b."user_id"
  AND (a."at", a."id") < (b."at", b."id");

-- DropIndex
DROP INDEX "external_service_tests_user_id_service_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "external_service_tests_user_id_service_id_key" ON "external_service_tests"("user_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_service_tests_instance_service_key" ON "external_service_tests"("service_id") WHERE (user_id IS NULL);
