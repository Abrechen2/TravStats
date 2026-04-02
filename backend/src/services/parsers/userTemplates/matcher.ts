import { prisma } from "../../../db";
import type { TemplateFingerprint, TemplatePatterns, TemplateStats, UserTemplate } from "./types";
import logger from "../../../utils/logger";

/**
 * Returns true when the email matches the given fingerprint.
 *
 * Match rules:
 * - ALL bodyMarkers must be present in body (case-sensitive)
 * - At least one of: senderDomain matches OR subjectPattern matches
 */
export function matchesFingerprint(
  fp: TemplateFingerprint,
  fromAddress: string,
  subject: string,
  body: string
): boolean {
  if (!fp.bodyMarkers.every((m) => body.includes(m))) return false;

  const senderDomain = fromAddress.toLowerCase().split("@")[1] ?? "";
  const domainMatch = fp.senderDomains.some(
    (d) => senderDomain === d || senderDomain.endsWith("." + d)
  );
  if (domainMatch) return true;

  const subjectLower = subject.toLowerCase();
  return fp.subjectPatterns.some((p) => subjectLower.includes(p.toLowerCase()));
}

/**
 * Finds the first active ParserTemplate that matches this email from the
 * user's own templates. Returns the template or null if none match.
 */
export async function findMatchingTemplate(
  userId: string,
  fromAddress: string,
  subject: string,
  body: string
): Promise<UserTemplate | null> {
  try {
    const templates = await prisma.parserTemplate.findMany({
      where: { userId, status: "active" },
      orderBy: { updatedAt: "desc" },
    });

    for (const t of templates) {
      const fp = t.fingerprint as unknown as TemplateFingerprint;
      if (matchesFingerprint(fp, fromAddress, subject, body)) {
        return {
          id: t.id,
          userId: t.userId,
          name: t.name,
          status: t.status as UserTemplate["status"],
          fingerprint: fp,
          patterns: t.patterns as unknown as TemplatePatterns,
          stats: t.stats as unknown as TemplateStats | undefined,
          sourceId: t.sourceId ?? undefined,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
        };
      }
    }

    return null;
  } catch (err: unknown) {
    logger.error({ err, userId }, "FingerprintMatcher: error querying templates");
    return null;
  }
}
