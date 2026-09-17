-- CreateIndex
CREATE INDEX "parser_templates_user_id_domain_status_idx" ON "parser_templates"("user_id", "domain", "status");
