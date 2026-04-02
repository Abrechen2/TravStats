-- CreateTable
CREATE TABLE "parser_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fingerprint" JSONB NOT NULL,
    "patterns" JSONB NOT NULL,
    "stats" JSONB,
    "source_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parser_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_corrections" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "got" TEXT NOT NULL,
    "email_fingerprint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parser_templates_user_id_status_idx" ON "parser_templates"("user_id", "status");

-- CreateIndex
CREATE INDEX "template_corrections_template_id_field_idx" ON "template_corrections"("template_id", "field");

-- AddForeignKey
ALTER TABLE "parser_templates" ADD CONSTRAINT "parser_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_corrections" ADD CONSTRAINT "template_corrections_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "parser_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_corrections" ADD CONSTRAINT "template_corrections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
