import type { Flight } from "../../types";

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
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="flex gap-1 items-center flex-shrink-0" onClick={stop} onMouseEnter={stop}>
      {(
        [
          { label: "✏️", title: "Bearbeiten", onClick: () => onEdit(flight) },
          { label: "🗺️", title: "Auf Map zeigen", onClick: onMapFocus },
          { label: "📊", title: "Stats", onClick: onStatsToggle },
          { label: "📋", title: "Duplizieren", onClick: () => onDuplicate(flight) },
          { label: "🗑️", title: "Löschen", onClick: () => onDelete(flight.id) },
        ] as const
      ).map(({ label, title, onClick }) => (
        <button
          key={title}
          onClick={onClick}
          title={title}
          className="w-7 h-7 flex items-center justify-center rounded text-sm transition-colors"
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
