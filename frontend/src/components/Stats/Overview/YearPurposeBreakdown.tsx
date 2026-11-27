import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { describePurpose, purposeGlyph } from "../../../lib/purposeDisplay";
import { formatDistance } from "../../../lib/units";
import { usePurposeCatalogue } from "../../../store/purposeCatalogueStore";
import { useSettingsStore } from "../../../store/settingsStore";
import type { PurposeShare } from "../../../types/yearStats";

/**
 * "Nach Zweck" under a year card: entries and kilometres per purpose. Shown only when at least one
 * entry of the year carries a purpose; entries without one are listed as "Nicht festgelegt", never
 * folded into private.
 */
export default function YearPurposeBreakdown({
  year,
  rows,
}: {
  year: number;
  rows: readonly PurposeShare[] | undefined;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["purpose", "stats"]);
  const catalogue = usePurposeCatalogue();
  const unit = useSettingsStore((s) => s.units.distanceUnit);
  if (!rows || !rows.some((r) => r.key !== null)) return null;
  const lang = i18n.language ?? "de";
  return (
    <div className="mt-3 text-xs" data-testid={`year-purpose-${year}`}>
      <p className="mb-1 font-medium" style={{ color: "var(--text-primary)" }}>
        {t("purpose:stats.title")}
      </p>
      <ul className="space-y-0.5">
        {rows.map((r) => {
          const shown = r.key ? describePurpose(t, catalogue, r.key, lang) : null;
          const label = shown
            ? `${purposeGlyph(shown.icon)} ${shown.label}`
            : t("purpose:stats.unknown");
          return (
            <li key={r.key ?? "unknown"} className="flex items-baseline justify-between gap-3">
              <span>{label}</span>
              <span style={{ color: "var(--text-muted)" }}>
                {t("purpose:stats.entries", { count: r.count })}
                {r.km !== null ? ` · ${formatDistance(r.km, unit, t, lang)}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
