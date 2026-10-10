import { prisma } from "../../../db";
import { workshopEnvelopeSchema, type TemplateEnvelope } from "../templates/v2/envelope";

/** The workshop domains whose user templates are stored as v2 envelopes. */
export type V2WorkshopDomain = "cruise" | "place" | "package";

/**
 * A workshop template's envelope, read back out of `ParserTemplate.patterns`
 * — or null when the row does not hold one of `domain`.
 *
 * Validated on every read, by the same schema module the deriver wrote it
 * with: `patterns` is a JSON column that outlives releases, and a row an older
 * version (or a hand-edited API call) wrote must be IGNORED, not crash a parse
 * that would otherwise have worked. The domain is checked twice — the row's
 * column and the envelope's own — so a cruise template can never be handed to
 * the place reader or the other way round, whatever the row claims.
 */
export function parseWorkshopEnvelope(
  patterns: unknown,
  domain: V2WorkshopDomain
): TemplateEnvelope | null {
  const parsed = workshopEnvelopeSchema.safeParse(patterns);
  if (!parsed.success || parsed.data.domain !== domain) return null;
  return parsed.data;
}

/**
 * Every ACTIVE workshop template of this user and domain, newest first.
 *
 * Callers run these AFTER the bundled and repository templates: a template
 * measured against a corpus keeps the first look, a personal one proven by a
 * single preview takes what those decline (the lodging rule, plan section 7).
 */
export async function loadActiveWorkshopTemplates(
  userId: string,
  domain: V2WorkshopDomain
): Promise<TemplateEnvelope[]> {
  const rows = await prisma.parserTemplate.findMany({
    where: { userId, domain, status: "active" },
    orderBy: { updatedAt: "desc" },
  });
  return rows
    .map((row) => parseWorkshopEnvelope(row.patterns, domain))
    .filter((template): template is TemplateEnvelope => template !== null);
}
