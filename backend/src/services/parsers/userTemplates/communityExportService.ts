import { prisma } from "../../../db";
import { appVersion } from "../../../utils/version";
import logger from "../../../utils/logger";
import type { AnnotationSelection } from "./annotations";
import {
  buildCommunityExport,
  githubNewFileUrl,
  isExportableDomain,
  type CommunityExportOutcome,
} from "./communityExport";
import { parseWorkshopEnvelope } from "./v2UserTemplates";

/** The marked values of the sample a template was derived from — what must not travel. */
function markedValues(annotations: unknown): Pick<AnnotationSelection, "label" | "text">[] {
  if (typeof annotations !== "object" || annotations === null) return [];
  const selections = (annotations as Record<string, unknown>).textSelections;
  if (!Array.isArray(selections)) return [];
  return selections.flatMap((s: unknown) => {
    if (typeof s !== "object" || s === null) return [];
    const { label, text } = s as Record<string, unknown>;
    return typeof label === "string" && typeof text === "string" ? [{ label, text }] : [];
  });
}

/**
 * One of the user's own templates as a repository file (forgejo#309), or the
 * reason it cannot be one. Only an ACTIVE template is shared — one whose
 * preview proved it reads its own sample — and only a v2 envelope: a flight
 * or lodging workshop template is stored in an older rule format the
 * repository does not take.
 */
export async function exportTemplateForCommunity(
  userId: string,
  templateId: string
): Promise<CommunityExportOutcome> {
  const row = await prisma.parserTemplate.findUnique({ where: { id: templateId } });
  if (!row || row.userId !== userId) return { ok: false, refusal: "notFound", found: [] };
  if (!isExportableDomain(row.domain)) {
    return { ok: false, refusal: "domainNotExportable", found: [] };
  }
  if (row.status !== "active") return { ok: false, refusal: "notActive", found: [] };
  const envelope = parseWorkshopEnvelope(row.patterns, row.domain);
  if (!envelope) return { ok: false, refusal: "notExportable", found: [] };

  const [sample, user] = await Promise.all([
    row.sourceId
      ? prisma.trainingData.findFirst({
          where: { id: row.sourceId, userId },
          select: { annotations: true, senderAddress: true },
        })
      : null,
    prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, firstName: true, lastName: true, notificationEmail: true },
    }),
  ]);
  // The scan only knows which values are personal from the sample's marks.
  // Without the sample a marked booking reference in an anchor would travel
  // unrecognised, so the export is refused rather than run blind. (Keeping
  // the marks on the template instead would copy the very values that must
  // not travel into a second place, and would not cover stored templates.)
  if (!sample) return { ok: false, refusal: "sourceMissing", found: [] };
  const result = buildCommunityExport({
    envelope,
    personal: {
      marked: markedValues(sample.annotations),
      identity: [
        user?.username,
        user?.firstName,
        user?.lastName,
        user?.notificationEmail,
        sample.senderAddress,
      ],
    },
    appVersion,
    today: new Date().toISOString().slice(0, 10),
  });
  if (!result.ok) {
    logger.info(
      { templateId, refusal: result.refusal, found: result.found.map((f) => f.path) },
      "Community export refused"
    );
    return result;
  }
  return {
    ...result,
    domain: row.domain,
    githubUrl: githubNewFileUrl(row.domain, result.filename),
  };
}
