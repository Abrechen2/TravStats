import { prisma } from "../../../db";
import type { Prisma } from "../../../prisma";
import type { TemplateDomain, TemplateFingerprint, TemplatePatterns } from "./types";
import logger from "../../../utils/logger";
import { WORKSHOP_DOMAIN_SPECS, isWorkshopDomain } from "../../../shared/annotationLabels";
import type { AnnotationSelection } from "./annotations";
import { escapeRegex } from "./annotations";
import { deriveLodgingTemplate } from "./lodgingDeriver";
import { senderAddressIn, senderDomainOf, subjectIn } from "./sampleHeaders";

// Character classes and length quantifiers per field
const FIELD_SPEC: Record<string, { chars: string; len: string }> = {
  pnr: { chars: "A-Z0-9", len: "{5,8}" },
  flightNumber: { chars: "A-Z0-9 ", len: "{4,8}" },
  departureCode: { chars: "A-Z", len: "{3}" },
  arrivalCode: { chars: "A-Z", len: "{3}" },
  aircraftType: { chars: "A-Za-z0-9\\s\\-", len: "{3,30}" },
};

const KNOWN_BODY_MARKERS = [
  "IATA-Code des Abflughafens",
  "IATA-Code des Ankunftsflughafens",
  "Buchungsübersicht",
  "Buchungscode",
  "Durchgeführt von",
  "Booking confirmation",
  "Flight number",
];

/**
 * Derives a context-anchored regex pattern for a single field annotation.
 * Returns a regex string with exactly one capture group, or undefined if
 * the annotation is too short to derive a reliable pattern.
 */
export function derivePatternFromSelection(
  selection: { text: string; label: string; start: number; end: number },
  fullText: string
): string | undefined {
  const value = selection.text.trim();
  if (!value || value.length < 2) return undefined;

  const spec = FIELD_SPEC[selection.label];
  if (!spec) return undefined;

  // Extract up to 80 chars before the value — take the last non-empty line as label context
  const CONTEXT_BEFORE = 80;
  const contextRaw = fullText.slice(Math.max(0, selection.start - CONTEXT_BEFORE), selection.start);
  const lines = contextRaw.split("\n");
  const labelLine = lines.filter((l) => l.trim().length > 0).pop() ?? "";
  const escapedLabel = escapeRegex(labelLine.trim());

  if (!escapedLabel) return undefined;

  return `${escapedLabel}\\s*([${spec.chars}]${spec.len})`;
}

/**
 * Extracts a TemplateFingerprint from plain-text email content.
 *
 * `senderDomain` is what the SAMPLE ROW knows — read from the real headers at
 * upload and kept in a column, because an `.eml`'s header block never reaches
 * the stored text (see `TrainingData.senderAddress`). The in-text `From:` read
 * is the fallback for a row written before that column existed and for a
 * pasted sample that carries its own header block.
 */
export function extractFingerprint(
  fullText: string,
  subject: string,
  senderDomain?: string
): TemplateFingerprint {
  const inText = senderDomainOf(senderAddressIn(fullText));
  const resolved = senderDomain ?? inText;
  const senderDomains = resolved ? [resolved] : [];

  // Subject pattern (stripped of user-specific data — dates, booking codes, routes)
  const cleanSubject = subject
    .replace(/\d{2}\.\d{2}\.\d{4}/g, "") // DD.MM.YYYY
    .replace(/\b\d{1,2}\s+\w+\s+\d{4}\b/g, "") // "14 November 2024"
    .replace(/\b[A-Z]{3}-[A-Z]{3}\b/g, "") // "MUC-FRA"
    .replace(/[A-Z0-9]{5,8}/g, "") // booking codes
    .replace(/[_|\s]+/g, " ") // collapse separators
    .trim();
  const subjectPatterns = cleanSubject.length > 4 ? [cleanSubject] : [subject];

  // Body markers: which known structural markers are present
  const bodyMarkers = KNOWN_BODY_MARKERS.filter((m) => fullText.includes(m));
  // Add structural label lines (tab-indented) if not enough markers found
  if (bodyMarkers.length < 2) {
    const tabLines = fullText
      .split("\n")
      .filter((l) => l.startsWith("\t") && l.trim().length > 4 && l.trim().length < 40)
      .slice(0, 2)
      .map((l) => l.trim());
    bodyMarkers.push(...tabLines);
  }

  return {
    senderDomains,
    subjectPatterns: subjectPatterns.filter(Boolean),
    bodyMarkers: [...new Set(bodyMarkers)].slice(0, 5),
  };
}

/**
 * Why no template was written, in one vocabulary for every domain.
 *
 * Abstention is a result (CLAUDE.md: "a value that cannot be derived is null
 * or absent, never zero"). The caller renders the reason; it never renders a
 * template that could not be built.
 */
export type DerivationOutcome =
  | { status: "derived"; templateId: string; domain: TemplateDomain }
  | { status: "abstained"; domain: TemplateDomain; reason: string }
  | { status: "failed"; reason: "noAnnotations" | "error" };

interface SampleAnnotations {
  fullText: string;
  subject: string;
  /** The sender's domain, from the row's column or from the text. */
  senderDomain?: string;
  selections: AnnotationSelection[];
}

/**
 * What the deriver reads, and in which order: the sample row's own
 * `senderAddress` and `subject` columns first, the header block inside the
 * stored text second.
 *
 * The order is the fix for the beta audit's NOT FIXED 5. The columns hold what
 * the uploaded file's headers said; the text is what survived
 * `filterEmailText`, which removes every address and leaves an `.eml` with no
 * header block at all. Reading the text first would mean preferring the
 * damaged copy to the intact one.
 */
function readAnnotations(
  annotations: unknown,
  stored?: { senderAddress: string | null; subject: string | null }
): SampleAnnotations | null {
  if (typeof annotations !== "object" || annotations === null) return null;
  const ann = annotations as Record<string, unknown>;
  const fullText = typeof ann.fullText === "string" ? ann.fullText : "";
  const selections: AnnotationSelection[] = Array.isArray(ann.textSelections)
    ? (ann.textSelections as unknown[]).filter(
        (s): s is AnnotationSelection =>
          typeof s === "object" &&
          s !== null &&
          typeof (s as Record<string, unknown>).text === "string" &&
          typeof (s as Record<string, unknown>).label === "string" &&
          typeof (s as Record<string, unknown>).start === "number" &&
          typeof (s as Record<string, unknown>).end === "number"
      )
    : [];
  if (!fullText || selections.length === 0) return null;
  const subject = stored?.subject?.trim() || subjectIn(fullText) || "";
  const senderDomain =
    senderDomainOf(stored?.senderAddress) ?? senderDomainOf(senderAddressIn(fullText));
  return { fullText, subject, ...(senderDomain ? { senderDomain } : {}), selections };
}

/** Flight patterns, unchanged since the workshop shipped — see `FIELD_SPEC`. */
function deriveFlightPatterns(sample: SampleAnnotations): TemplatePatterns {
  const { fullText, selections } = sample;
  const patterns: TemplatePatterns = {};
  const safePatternKeys = new Set(Object.keys(FIELD_SPEC));
  for (const sel of selections) {
    // Times come from the structural Reiseplan segment parser, not a pattern.
    if (sel.label === "departureTime" || sel.label === "arrivalTime") continue;
    const pattern = derivePatternFromSelection(sel, fullText);
    if (pattern && safePatternKeys.has(sel.label)) {
      (patterns as Record<string, string>)[sel.label] = pattern;
    }
  }

  if (fullText.includes("Reiseplan") && fullText.includes("Durchgeführt")) {
    patterns.useReiseplanSegments = true;
  }

  // Buchungsdetails IATA block when the standard IATA labels are missing.
  if (!patterns.departureCode && fullText.includes("<https://")) {
    patterns.detailsBlock =
      "([A-Z]{3})\\s+<https?://[^>]+>\\s+([A-Z]{3})[\\s\\S]{1,300}?(\\d{2}:\\d{2})\\s*\\n\\s*(\\d{2}:\\d{2})";
  }
  return patterns;
}

function derivedName(issuer: string): string {
  return `${issuer} (abgeleitet am ${new Date().toLocaleDateString("de-DE")})`;
}

/**
 * Derive a template from a saved annotation, in the domain the sample was
 * pasted for — forgejo#124 phase 6.
 *
 * Two things changed here, and both ARE the phase:
 *
 * 1. **The domain is read from the sample and WRITTEN to the template.**
 *    Before this, `ParserTemplate.domain` took its default on every row, so
 *    every template was a flight template whatever the document was. The
 *    matcher has filtered on that column since phase 1; this is what finally
 *    gives it something to filter.
 * 2. **Nothing activates itself.** A template used to reach `active` when its
 *    fingerprint had one body marker — a statement about MATCHING, which says
 *    nothing about extraction. It is `pending` now until a preview has run it
 *    against its own sample and a held-out one (`routes/parserTemplates.ts`).
 *
 * Cruise and place abstain and say why: no reader in this tree can run a
 * template for them (`shared/annotationLabels.ts` carries the reason). A
 * template that matches a document and extracts nothing is worse than none,
 * because its result is a proposal a human accepts by habit (plan §7).
 */
export async function deriveTemplateFromAnnotation(
  trainingDataId: string,
  userId: string
): Promise<DerivationOutcome> {
  try {
    const td = await prisma.trainingData.findUnique({ where: { id: trainingDataId } });
    if (!td?.annotations) {
      logger.warn({ trainingDataId }, "TemplateDeriver: no annotations found");
      return { status: "failed", reason: "noAnnotations" };
    }

    const domain: TemplateDomain = isWorkshopDomain(td.domain) ? td.domain : "flight";
    const spec = WORKSHOP_DOMAIN_SPECS[domain];
    if (!spec.derivable) {
      logger.info({ trainingDataId, domain }, "TemplateDeriver: no reader for this domain");
      return { status: "abstained", domain, reason: spec.reason ?? "notDerivable" };
    }

    const sample = readAnnotations(td.annotations, {
      senderAddress: td.senderAddress,
      subject: td.subject,
    });
    if (!sample) return { status: "failed", reason: "noAnnotations" };

    const fingerprint = extractFingerprint(sample.fullText, sample.subject, sample.senderDomain);
    let patterns: Prisma.InputJsonValue;
    let name: string;

    if (domain === "lodging") {
      const derived = deriveLodgingTemplate({
        id: `lodging:user:${trainingDataId}`,
        name: fingerprint.senderDomains[0] ?? sample.subject.slice(0, 40) ?? "",
        subject: sample.subject,
        fullText: sample.fullText,
        selections: sample.selections,
        senderDomain: fingerprint.senderDomains[0],
      });
      if (!derived.ok) {
        logger.info(
          { trainingDataId, refusal: derived.refusal },
          "TemplateDeriver: the lodging annotation was not enough"
        );
        return { status: "abstained", domain, reason: derived.refusal };
      }
      patterns = derived.template as unknown as Prisma.InputJsonValue;
      name = derivedName(derived.template.name || "Hotel");
    } else {
      patterns = deriveFlightPatterns(sample) as unknown as Prisma.InputJsonValue;
      const airlineMatch = /(?:Lufthansa|Swiss|Austrian|Ryanair|Eurowings|easyJet)/i.exec(
        sample.fullText
      );
      name = derivedName(airlineMatch ? airlineMatch[0] : "Unknown");
    }

    const storedFingerprint = fingerprint as unknown as Prisma.InputJsonValue;
    const freshStats = { matchCount: 0, successRate: 0 } as unknown as Prisma.InputJsonValue;

    const existing = await prisma.parserTemplate.findFirst({
      where: { userId, sourceId: trainingDataId },
    });

    if (existing) {
      const updated = await prisma.parserTemplate.update({
        where: { id: existing.id },
        data: {
          domain,
          patterns,
          fingerprint: storedFingerprint,
          // A re-derivation is a new template wearing an old id: whatever the
          // last preview proved was proved about patterns that are now gone.
          // Back to `pending`, and the preview runs again.
          status: "pending",
          stats: freshStats,
          updatedAt: new Date(),
        },
      });
      logger.info({ templateId: updated.id, domain }, "TemplateDeriver: updated existing template");
      return { status: "derived", templateId: updated.id, domain };
    }

    const created = await prisma.parserTemplate.create({
      data: {
        userId,
        domain,
        name,
        status: "pending",
        fingerprint: storedFingerprint,
        patterns,
        sourceId: trainingDataId,
        stats: freshStats,
      },
    });

    logger.info({ templateId: created.id, domain, name }, "TemplateDeriver: derived new template");
    return { status: "derived", templateId: created.id, domain };
  } catch (err: unknown) {
    logger.error({ err, trainingDataId }, "TemplateDeriver: unexpected error");
    return { status: "failed", reason: "error" };
  }
}
