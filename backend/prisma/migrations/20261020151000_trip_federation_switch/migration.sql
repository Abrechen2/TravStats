-- Trip sharing across servers (spec 2026-10-20 F8): the admin's switch, default off.
-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "trip_federation_enabled" BOOLEAN NOT NULL DEFAULT false;
