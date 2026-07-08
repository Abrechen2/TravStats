import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";

export type WindowKind = "rolling12m" | "year" | "all";

interface TimeRangeControlProps {
  value: WindowKind;
  onChange: (w: WindowKind) => void;
}

const ORDER: WindowKind[] = ["rolling12m", "year", "all"];

// Segmented control driving the rolling/year/all-time window. "year" reuses
// the page's existing selectedYear (no second year picker in Wave A).
export default function TimeRangeControl({ value, onChange }: TimeRangeControlProps): JSX.Element {
  const { t } = useTranslation(["stats"]);
  return (
    <div
      className="inline-flex rounded-lg p-0.5 mb-4"
      style={{ background: "var(--bg-muted)", border: "1px solid var(--color-border)" }}
      role="group"
    >
      {ORDER.map((kind) => {
        const active = kind === value;
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(kind)}
            className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
            style={{
              background: active ? "var(--accent)" : "transparent",
              color: active ? "#1a1205" : "var(--text-secondary)",
            }}
          >
            {t(`stats:timeRange.${kind}`)}
          </button>
        );
      })}
    </div>
  );
}
