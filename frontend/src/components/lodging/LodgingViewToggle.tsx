import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

export type LodgingView = "houses" | "stays";

/**
 * Houses or stays (forgejo#226): the same logbook, two ways to read it. A
 * segmented control with real buttons and `aria-pressed`, sized for a finger
 * on a coarse pointer.
 */
export function LodgingViewToggle({
  value,
  onChange,
}: {
  value: LodgingView;
  onChange: (view: LodgingView) => void;
}): JSX.Element {
  const { t } = useTranslation(["lodging"]);
  return (
    <div
      role="group"
      aria-label={t("lodging:stayView.toggle.label")}
      className="inline-flex rounded-lg border border-[var(--color-border)] p-0.5"
    >
      {(["houses", "stays"] as const).map((view) => {
        const active = view === value;
        return (
          <button
            key={view}
            type="button"
            aria-pressed={active}
            data-testid={`lodging-view-${view}`}
            onClick={() => onChange(view)}
            className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors pointer-coarse:min-h-(--ts-size-touch-min)"
            style={{
              background: active ? "var(--accent)" : "transparent",
              color: active ? "var(--ts-accent-text)" : "var(--text-secondary)",
            }}
          >
            {t(`lodging:stayView.toggle.${view}`)}
          </button>
        );
      })}
    </div>
  );
}
