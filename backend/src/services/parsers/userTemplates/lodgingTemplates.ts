import { prisma } from "../../../db";
import type { LodgingTemplate } from "../../lodging/templates/types";

/**
 * The user's own lodging templates, read back out of `ParserTemplate.patterns`.
 *
 * forgejo#124 phase 6. A lodging workshop template stores the declarative spec
 * itself — the same object `services/lodging/templates/builtins.ts` holds for
 * KOA or Hilton — so reading one back is a shape check, not a conversion.
 *
 * The shape check is not decoration: `patterns` is a JSON column, the rows
 * outlive any given release, and a template written by an older version (or by
 * a user editing the API directly) must be IGNORED rather than crash a parse
 * that would otherwise have worked. A template nobody can read is a template
 * that does not run; that is a missing feature, not a broken import.
 */
export function parseLodgingSpec(patterns: unknown): LodgingTemplate | null {
  if (typeof patterns !== "object" || patterns === null) return null;
  const candidate = patterns as Partial<LodgingTemplate>;
  const match = candidate.match;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof match !== "object" ||
    match === null ||
    !Array.isArray(match.markers) ||
    !Array.isArray(match.anchors) ||
    match.anchors.length === 0 ||
    typeof candidate.fields !== "object" ||
    candidate.fields === null ||
    !Array.isArray(candidate.required)
  ) {
    return null;
  }
  return candidate as LodgingTemplate;
}

/**
 * Every active lodging template this user owns, newest first.
 *
 * Deliberately a separate query from `findMatchingTemplate`: that one answers
 * with the FIRST fingerprint match, which is the flight workshop's matching
 * rule (sender domain / subject / body markers). A lodging template carries
 * the built-in readers' own `match` block instead, and it is the lodging
 * engine that decides whether it applies — so this returns all of them and
 * lets `templateMatches` judge, exactly as the built-in list is judged.
 */
export async function loadActiveLodgingTemplates(userId: string): Promise<LodgingTemplate[]> {
  const rows = await prisma.parserTemplate.findMany({
    where: { userId, domain: "lodging", status: "active" },
    orderBy: { updatedAt: "desc" },
  });
  const specs: LodgingTemplate[] = [];
  for (const row of rows) {
    const spec = parseLodgingSpec(row.patterns);
    if (spec) specs.push({ ...spec, name: row.name });
  }
  return specs;
}
