import type { RentalDeadlineField } from "../api/rental";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The toast after a reviewed rental document was applied. A later mail that
 * fills a deadline the stored booking lacked changes the record, so it is named
 * — the lodging import says the same (`lodgingImportResult.ts`).
 */
export function describeRentalImportSaved(
  filledDeadlines: readonly RentalDeadlineField[],
  t: Translate
): string {
  const saved = t("rental:import.saved");
  if (filledDeadlines.length === 0) return saved;
  const fields = filledDeadlines.map((f) => t(`rental:import.deadlineField.${f}`)).join(", ");
  return saved + t("rental:import.deadlinesFilledSuffix", { fields });
}
