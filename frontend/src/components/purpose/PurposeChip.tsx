import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { describePurpose, entryPurposeKey, purposeGlyph } from "../../lib/purposeDisplay";
import { usePurposeCatalogue } from "../../store/purposeCatalogueStore";
import { DEFAULT_KEY_OF_KIND } from "../../shared/purposeCatalogue";

/**
 * The quiet purpose chip. A business entry shows "geschäftlich" (or its detailed purpose, e.g.
 * "Messe & Konferenz"); a private entry shows its detail only when it has one ("Urlaub") —
 * "Privat (sonstiges)" is the common case and stays silent. Unknown shows nothing and must not
 * look like either.
 */
export default function PurposeChip({
  entry,
}: {
  entry: { purpose?: string | null; purposeKey?: string | null } | null | undefined;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["purpose"]);
  const catalogue = usePurposeCatalogue();
  const key = entryPurposeKey(catalogue, entry);
  if (!key || key === DEFAULT_KEY_OF_KIND.private) return null;
  const shown =
    key === DEFAULT_KEY_OF_KIND.business
      ? null
      : describePurpose(t, catalogue, key, i18n.language ?? "de");
  return (
    <span
      className="t-caption"
      data-testid="purpose-chip"
      title={shown ? shown.label : t("purpose:chip.title")}
      style={{
        border: `1px solid ${shown?.color ?? "var(--ts-border)"}`,
        borderRadius: 999,
        padding: "0 var(--ts-space-sm)",
        whiteSpace: "nowrap",
      }}
    >
      {shown ? `${purposeGlyph(shown.icon)} ${shown.label}` : t("purpose:chip.label")}
    </span>
  );
}
