-- CreateTable
CREATE TABLE "lodging_chain_retired_names" (
    "name" TEXT NOT NULL,
    "retired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_chain_retired_names_pkey" PRIMARY KEY ("name")
);
