-- Notes (forgejo#137) take the shared exactly-once mechanism (forgejo#283,
-- `client_write_refs` / `services/sync/clientRef.ts`) instead of a private
-- `client_id` column. Notes were never released, so no row carries a value
-- worth migrating into `client_write_refs`.

/*
  Warnings:

  - You are about to drop the column `client_id` on the `notes` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "notes_user_id_client_id_key";

-- AlterTable
ALTER TABLE "notes" DROP COLUMN "client_id";
