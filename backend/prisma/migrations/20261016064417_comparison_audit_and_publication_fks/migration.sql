-- Orphans first: audit rows of already-deleted accounts and ciphertext of already-deleted
-- links were never cleaned up, because neither column had a foreign key to cascade from.
DELETE FROM "comparison_audit" a
WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."owner_id");

DELETE FROM "comparison_publications" p
WHERE NOT EXISTS (SELECT 1 FROM "comparison_links" l WHERE l."id" = p."link_id");

-- AddForeignKey
ALTER TABLE "comparison_audit" ADD CONSTRAINT "comparison_audit_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparison_publications" ADD CONSTRAINT "comparison_publications_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "comparison_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
