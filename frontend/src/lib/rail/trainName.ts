type Translate = (key: string, options?: Record<string, unknown>) => string;

/** How a train known by its number alone reads: "Zug 57031". */
export type BareTrainName = (number: string) => string;

export const bareTrainName =
  (t: Translate): BareTrainName =>
  (number) =>
    t("rail:bareTrain", { number });

/**
 * "ICE 578", "S 1" — and "Zug 57031" for a train bahn.de names by number only.
 * The stored fields stay as read (no category, number 57031); only the label
 * says what the bare number is, and no category is guessed for it.
 */
export function trainName(
  category: string | null | undefined,
  number: string | null | undefined,
  bare: BareTrainName
): string {
  const c = category?.trim() ?? "";
  const n = number?.trim() ?? "";
  if (c === "" && n !== "") return bare(n);
  // Rows read before rc.21 stored the bare number as the category.
  if (n === "" && /^\d{1,6}$/.test(c)) return bare(c);
  return [c, n].filter(Boolean).join(" ");
}
