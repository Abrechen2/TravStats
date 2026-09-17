-- Two settings that were stored, echoed by the admin API, and read by NOTHING.
--
-- Measured 2026-09-17: no parser consulted `default_text_parser` or
-- `default_vision_parser`; `getParserConfig` hardcodes its chain, and the admin
-- page never rendered a control for either — it shows two static tiles instead.
-- So no user ever chose these values, and dropping them loses no decision.
--
-- What replaces the text half is `parser_order`, added in the migration before
-- this one, which a parser actually reads. The vision half has nothing to
-- choose between: the OCR chain is tesseract.

-- AlterTable
ALTER TABLE "admin_settings" DROP COLUMN "default_text_parser",
DROP COLUMN "default_vision_parser";
