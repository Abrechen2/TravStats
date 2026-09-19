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
