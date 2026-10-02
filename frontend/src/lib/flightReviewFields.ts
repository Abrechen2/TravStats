import type { ParsedBooking } from "../types";

/**
 * Pure helpers of the flight review step, kept out of FlightReviewModal.tsx so
 * that file stays under the 800-line limit.
 */

/** Whether the parser inferred a field (under its own name or an alias) rather than reading it. */
export function isInferred(
  fieldName: string,
  inferredFields?: string[],
  aliases: readonly string[] = []
): boolean {
  if (!inferredFields || inferredFields.length === 0) return false;
  if (inferredFields.includes(fieldName)) return true;
  return aliases.some((alias) => inferredFields.includes(alias));
}

/** Token classes for the parser-confidence pill. */
export function getConfidenceColor(confidence: number): string {
  if (confidence >= 70) return "text-(--success) bg-(--success)/15";
  if (confidence >= 40) return "text-(--warning) bg-(--warning)/15";
  return "text-(--danger) bg-(--danger)/15";
}

/** Left-border colour by where a field's value came from (template, LLM, nothing). */
export function getFieldBorderClass(
  fieldName: string,
  fieldSources?: ParsedBooking["fieldSources"]
): string {
  if (!fieldSources) return "";
  const source = fieldSources[fieldName as keyof NonNullable<ParsedBooking["fieldSources"]>];
  if (source === "template") return "border-l-4 border-green-500";
  if (source === "llm") return "border-l-4 border-yellow-400";
  if (source === "empty") return "border-l-4 border-red-500";
  return "";
}

/**
 * A parsed instant as a datetime-local value. A zone-less string like
 * "2023-10-17T00:00" is taken as written: converting it through UTC would
 * shift the date by the local offset.
 */
export function formatDateTimeLocal(isoString: string): string {
  const match = isoString.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (match) return `${match[1]}T${match[2]}`;
  try {
    return new Date(isoString).toISOString().slice(0, 16);
  } catch {
    return "";
  }
}

/** The parser's seat-class wording as a FlightInput seat class, or null. */
export function mapSeatClass(
  seatClass?: string
): "economy" | "premium_economy" | "business" | "first" | null {
  if (!seatClass) return null;
  const lower = seatClass.toLowerCase();
  if (lower.includes("first")) return "first";
  if (lower.includes("business")) return "business";
  if (lower.includes("premium")) return "premium_economy";
  if (lower.includes("economy")) return "economy";
  return null;
}
