import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  RENTAL_DOCUMENT_CATEGORIES,
  type RentalDocumentCategory,
  type TravelDocument,
} from "../../lib/api/documents";

/**
 * A rental's evidence, sorted by what it shows (forgejo#239): pickup, return,
 * damage, fuel, odometer, then everything not yet sorted — which is every
 * attachment kept before categories existed. A grouping of the SAME
 * documents: nothing is copied, and a group with nothing in it is not drawn.
 */
export function groupByRentalCategory(
  documents: readonly TravelDocument[]
): Array<{ category: RentalDocumentCategory | null; documents: TravelDocument[] }> {
  const groups = [...RENTAL_DOCUMENT_CATEGORIES, null].map((category) => ({
    category,
    documents: documents.filter((d) => (d.rentalCategory ?? null) === category),
  }));
  return groups.filter((g) => g.documents.length > 0);
}

export function RentalCategorySelect({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  /** The visible-or-accessible name; a row's select names its document. */
  label: string;
  value: RentalDocumentCategory | null;
  onChange: (next: RentalDocumentCategory | null) => void;
  disabled?: boolean;
}): JSX.Element {
  const { t } = useTranslation(["documents"]);
  return (
    <select
      id={id}
      aria-label={label}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e): void =>
        onChange(e.target.value === "" ? null : (e.target.value as RentalDocumentCategory))
      }
      className="rounded-md border border-border bg-(--bg-surface) px-2 py-1 text-xs pointer-coarse:min-h-(--ts-size-touch-min)"
    >
      <option value="">{t("documents:rentalCategory.none")}</option>
      {RENTAL_DOCUMENT_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {t(`documents:rentalCategory.${c}`)}
        </option>
      ))}
    </select>
  );
}
