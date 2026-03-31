-- CreateTable
CREATE TABLE "parse_training_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "airline" TEXT,
    "template_used" TEXT,
    "template_hit" BOOLEAN NOT NULL,
    "confidence" INTEGER,
    "field_count" INTEGER NOT NULL,
    "missing_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "parser_provider" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parse_training_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parse_training_logs_user_id_idx" ON "parse_training_logs"("user_id");

-- CreateIndex
CREATE INDEX "parse_training_logs_template_hit_idx" ON "parse_training_logs"("template_hit");

-- CreateIndex
CREATE INDEX "parse_training_logs_airline_idx" ON "parse_training_logs"("airline");

-- AddForeignKey
ALTER TABLE "parse_training_logs" ADD CONSTRAINT "parse_training_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
