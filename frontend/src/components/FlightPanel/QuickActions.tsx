import type { Flight } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

interface QuickActionsProps {
  flight: Flight;
  onEdit: (flight: Flight) => void;
  onMapFocus: () => void;
  onStatsToggle: () => void;
  onDuplicate: (flight: Flight) => void;
  onDelete: (flightId: string) => void;
}

export function QuickActions({
  flight,
  onEdit,
  onMapFocus,
  onStatsToggle,
  onDuplicate,
  onDelete,
}: QuickActionsProps): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="flex gap-1 items-center shrink-0" onClick={stop} onMouseEnter={stop}>
      {(
        [
          { label: "✏️", title: t("common:buttons.edit"), onClick: () => onEdit(flight) },
          { label: "🗺️", title: t("flights:quickActions.showOnMap"), onClick: onMapFocus },
          { label: "📊", title: t("flights:quickActions.stats"), onClick: onStatsToggle },
          { label: "📋", title: t("common:buttons.duplicate"), onClick: () => onDuplicate(flight) },
          { label: "🗑️", title: t("common:buttons.delete"), onClick: () => onDelete(flight.id) },
        ] as const
      ).map(({ label, title, onClick }) => (
        <button
          key={title}
          onClick={onClick}
          title={title}
          // 28 px for a mouse, 44 px on a coarse pointer (forgejo#249).
          className="w-7 h-7 flex items-center justify-center rounded-sm text-sm transition-colors pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:min-w-(--ts-size-touch-min)"
          style={{ background: "var(--bg-surface)" }}
          type="button"
          aria-label={title}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
