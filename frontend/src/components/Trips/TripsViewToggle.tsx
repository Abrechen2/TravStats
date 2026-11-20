import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { TripsView } from "./useTripsView";

/** Tiles or list: the lodging page's segmented control, for the trips page. */
export function TripsViewToggle({
  value,
  onChange,
}: {
  value: TripsView;
  onChange: (view: TripsView) => void;
}): JSX.Element {
  const { t } = useTranslation(["trips"]);
  return (
    <div
      role="group"
      aria-label={t("trips:view.label")}
      className="inline-flex rounded-lg border border-[var(--color-border)] p-0.5"
    >
      {(["tiles", "list"] as const).map((view) => {
        const active = view === value;
        return (
          <button
            key={view}
            type="button"
            aria-pressed={active}
            data-testid={`trips-view-${view}`}
            onClick={() => onChange(view)}
            className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors pointer-coarse:min-h-(--ts-size-touch-min)"
            style={{
              background: active ? "var(--accent)" : "transparent",
              color: active ? "var(--ts-accent-text)" : "var(--text-secondary)",
            }}
          >
            {t(`trips:view.${view}`)}
          </button>
        );
      })}
    </div>
  );
}
