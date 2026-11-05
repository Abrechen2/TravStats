/*
  Warnings:

  - You are about to drop the column `entity_version` on the `client_write_refs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "client_write_refs" DROP COLUMN "entity_version";
