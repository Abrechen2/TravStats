-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "parsed_at" TIMESTAMP(3);

-- Stamp the moment a reading was stored or changed, whoever wrote it (parse by
-- id, retained parse, mail intake, extract-values): the document-link pass
-- rescans a document whose reading is newer than its last scan.
CREATE OR REPLACE FUNCTION documents_set_parsed_at() RETURNS trigger AS $$
BEGIN
  IF NEW.parsed_payload IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.parsed_payload IS DISTINCT FROM OLD.parsed_payload) THEN
    NEW.parsed_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_parsed_at
  BEFORE INSERT OR UPDATE OF parsed_payload ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_set_parsed_at();
