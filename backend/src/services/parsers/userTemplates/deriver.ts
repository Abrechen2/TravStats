import { prisma } from "../../../db";
import type { Prisma } from "@prisma/client";
import type { TemplateFingerprint, TemplatePatterns } from "./types";
import logger from "../../../utils/logger";

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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
 */
export function extractFingerprint(
  fullText: string,
  subject: string
): TemplateFingerprint {
  // Sender domain from "From:" header line
  const fromMatch = /^From:\s*.*?@([\w.-]+)/im.exec(fullText);
  const senderDomains = fromMatch ? [fromMatch[1].toLowerCase()] : [];

  // Subject pattern (stripped of user-specific data — dates, booking codes, routes)
  const cleanSubject = subject
    .replace(/\d{2}\.\d{2}\.\d{4}/g, "")           // DD.MM.YYYY
    .replace(/\b\d{1,2}\s+\w+\s+\d{4}\b/g, "")     // "14 November 2024"
    .replace(/\b[A-Z]{3}-[A-Z]{3}\b/g, "")          // "MUC-FRA"
    .replace(/[A-Z0-9]{5,8}/g, "")                  // booking codes
    .replace(/[_|\s]+/g, " ")                        // collapse separators
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

interface TextSelection {
  start: number;
  end: number;
  text: string;
  label: string;
  flightIndex?: number;
}

/**
 * Derives a ParserTemplate from a saved TrainingData annotation and
 * writes it to the database with status "active" if fingerprint has
 * at least one body marker, otherwise "pending".
 *
 * Returns the created template id, or undefined if derivation fails.
 */
export async function deriveTemplateFromAnnotation(
  trainingDataId: string,
  userId: string
): Promise<string | undefined> {
  try {
    const td = await prisma.trainingData.findUnique({
      where: { id: trainingDataId },
    });

    if (!td?.annotations) {
      logger.warn({ trainingDataId }, "TemplateDeriver: no annotations found");
      return undefined;
    }

    const ann = td.annotations as Record<string, unknown>;
    const fullText = typeof ann.fullText === "string" ? ann.fullText : "";
    const textSelections: TextSelection[] = Array.isArray(ann.textSelections)
      ? (ann.textSelections as unknown[]).filter(
          (s): s is TextSelection =>
            typeof s === "object" &&
            s !== null &&
            typeof (s as Record<string, unknown>).text === "string" &&
            typeof (s as Record<string, unknown>).label === "string" &&
            typeof (s as Record<string, unknown>).start === "number" &&
            typeof (s as Record<string, unknown>).end === "number"
        )
      : [];

    if (!fullText || textSelections.length === 0) {
      return undefined;
    }

    // Derive per-field patterns (skip time fields — handled by Reiseplan segments)
    const patterns: TemplatePatterns = {};
    const safePatternKeys = new Set(Object.keys(FIELD_SPEC));
    for (const sel of textSelections) {
      if (sel.label === "departureTime" || sel.label === "arrivalTime") continue;
      const pattern = derivePatternFromSelection(sel, fullText);
      if (pattern && safePatternKeys.has(sel.label)) {
        (patterns as Record<string, string>)[sel.label] = pattern;
      }
    }

    // Use structural Reiseplan parser when the email contains the anchor keywords
    if (fullText.includes("Reiseplan") && fullText.includes("Durchgeführt")) {
      patterns.useReiseplanSegments = true;
    }

    // Use Buchungsdetails IATA block when standard IATA labels are missing
    if (!patterns.departureCode && fullText.includes("<https://")) {
      patterns.detailsBlock =
        "([A-Z]{3})\\s+<https?://[^>]+>\\s+([A-Z]{3})[\\s\\S]{1,300}?(\\d{2}:\\d{2})\\s*\\n\\s*(\\d{2}:\\d{2})";
    }

    // Derive fingerprint from email content
    const subjectMatch = /^Subject:\s*(.+)$/im.exec(fullText);
    const subject = subjectMatch ? subjectMatch[1].trim() : "";
    const fingerprint = extractFingerprint(fullText, subject);

    // Name template from airline name if detectable
    const airlineMatch =
      /(?:Lufthansa|Swiss|Austrian|Ryanair|Eurowings|easyJet)/i.exec(fullText);
    const airline = airlineMatch ? airlineMatch[0] : "Unknown";
    const name = `${airline} (abgeleitet am ${new Date().toLocaleDateString("de-DE")})`;

    const status = fingerprint.bodyMarkers.length >= 1 ? "active" : "pending";

    const existing = await prisma.parserTemplate.findFirst({
      where: { userId, sourceId: trainingDataId },
    });

    if (existing) {
      const updated = await prisma.parserTemplate.update({
        where: { id: existing.id },
        data: {
          patterns: patterns as unknown as Prisma.InputJsonValue,
          fingerprint: fingerprint as unknown as Prisma.InputJsonValue,
          status,
          updatedAt: new Date(),
        },
      });
      logger.info({ templateId: updated.id, status }, "TemplateDeriver: updated existing template");
      return updated.id;
    }

    const created = await prisma.parserTemplate.create({
      data: {
        userId,
        name,
        status,
        fingerprint: fingerprint as unknown as Prisma.InputJsonValue,
        patterns: patterns as unknown as Prisma.InputJsonValue,
        sourceId: trainingDataId,
        stats: { matchCount: 0, successRate: 0 } as unknown as Prisma.InputJsonValue,
      },
    });

    logger.info({ templateId: created.id, status, name }, "TemplateDeriver: derived new template");
    return created.id;
  } catch (err: unknown) {
    logger.error({ err, trainingDataId }, "TemplateDeriver: unexpected error");
    return undefined;
  }
}
