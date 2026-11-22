import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * The quiet "geschäftlich" chip of a business entry. Private and unknown entries show nothing:
 * private is the common case, and unknown must not look like either.
 */
export default function PurposeChip({
  entry,
}: {
  entry: { purpose?: string | null } | null | undefined;
}): JSX.Element | null {
  const { t } = useTranslation(["purpose"]);
  if (entry?.purpose !== "business") return null;
  return (
    <span
      className="t-caption"
      data-testid="purpose-chip"
      style={{
        border: "1px solid var(--ts-border)",
        borderRadius: 999,
        padding: "0 var(--ts-space-sm)",
        whiteSpace: "nowrap",
      }}
    >
      {t("purpose:chip.label")}
    </span>
  );
}
