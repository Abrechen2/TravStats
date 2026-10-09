/**
 * The two Berge & Meer drafts under `docs/templates-drafts/package/`, loaded
 * the way the template loader would load them. Shared by the tests that prove
 * the drafts before they go to the template repository.
 */
import fs from "fs";
import path from "path";
import { validateEnvelope, type TemplateEnvelope } from "../../../parsers/templates/v2/envelope";

export const DRAFT_DIR = path.join(__dirname, "../../../../../../docs/templates-drafts/package");
export const DRAFT_FILES = ["berge-meer-invoice.json", "berge-meer-documents.json"] as const;

export function readDraft(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(DRAFT_DIR, file), "utf8"));
}

export function loadDrafts(): TemplateEnvelope[] {
  return DRAFT_FILES.map((file) => {
    const checked = validateEnvelope(readDraft(file));
    if (!checked.ok) throw new Error(`${file}: ${checked.errors.join("; ")}`);
    return checked.template;
  });
}

/** The draft's first `match` test case, as the text a parse would see. */
export function matchInput(template: TemplateEnvelope): string {
  const input = template.testCases.find((c) => c.expect === "match")!.input;
  return typeof input === "string" ? input : input.text;
}
