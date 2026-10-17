-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "stay_suggestions_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "stay_suggestions_immich_evidence" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "stay_suggestions_llm_place_classification" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trip_suggestions_enabled" BOOLEAN NOT NULL DEFAULT true;
