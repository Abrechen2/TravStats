-- AlterTable
ALTER TABLE "user_webdav_syncs" ADD COLUMN     "uploaded_files" TEXT[] DEFAULT ARRAY[]::TEXT[];
