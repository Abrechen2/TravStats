/**
 * Place consumption of v2 templates (forgejo#124): the one place a `place`
 * template's values become a place import candidate.
 *
 * There is no compiled-in place reader and there will not be one (owner
 * ruling: only generic readers live in the server, every issuer layout is a
 * template). A museum ticket, a guided-tour booking or a park reservation is
 * read by a template the user derived in the workshop from one of their own
 * documents — or, once the template repository carries place templates, by
 * one of those, which runs FIRST.
 *
 * Nothing here writes. The candidate goes to the existing place import
 * preview (`/place-import/preview`), which geocodes, deduplicates and offers a
 * row without a position back to the user — the same two-step contract as the
 * CSV import, so a place read from a document is never created silently.
 */
import { z } from "zod";
import logger from "../../utils/logger";
import type { PlaceImportCandidate } from "../../schemas/placeImport";
import type { TemplateEnvelope } from "../parsers/templates/v2/envelope";
import { applyTemplate } from "../parsers/templates/v2/runners";

const text = (max: number) => z.string().trim().min(1).max(max).nullish();

/** What a place template may read. Values of the wrong type decline the template. */
export const placeValuesSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: text(60),
  address: text(300),
  city: text(120),
  country: text(120),
  notes: text(2000),
  visitedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
});

/** One candidate from one template, or null when it declines the document. */
export function applyV2PlaceTemplate(
  template: TemplateEnvelope,
  documentText: string
): PlaceImportCandidate | null {
  if (template.domain !== "place") return null;
  const application = applyTemplate(template, documentText);
  if (!application.matched) return null;
  const parsed = placeValuesSchema.safeParse(application.values);
  if (!parsed.success) {
    logger.warn(
      {
        template: template.id,
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      "v2 place template produced values of the wrong shape — declined"
    );
    return null;
  }
  const values = parsed.data;
  // Absent, not null-valued: a field the template could not read stays out.
  const optional = Object.fromEntries(
    (["category", "address", "city", "country", "notes", "visitedAt"] as const)
      .filter((key) => values[key] !== null && values[key] !== undefined)
      .map((key) => [key, values[key]])
  );
  return { sourceRowIndex: 0, name: values.name, ...optional };
}

/** The candidate of the first template, in the order given, that reads the document. */
export function readWithV2PlaceTemplates(
  templates: readonly TemplateEnvelope[],
  documentText: string
): { candidate: PlaceImportCandidate; templateId: string } | null {
  for (const template of templates) {
    const candidate = applyV2PlaceTemplate(template, documentText);
    if (candidate) return { candidate, templateId: template.id };
  }
  return null;
}
