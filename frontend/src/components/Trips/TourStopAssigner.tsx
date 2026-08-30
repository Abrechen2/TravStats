import { useTranslation } from "../../hooks/useTranslation";
import type { TourStop } from "../../types/tour";

interface Props {
  stops: TourStop[];
  onChange: (orderedIds: string[]) => void;
}

/**
 * Controlled stop-assignment editor for one tour route section.
 *
 * Holds no state of its own — membership AND order come entirely from
 * `stop.routeOrderIdx`: non-null means "in THIS section, at this position",
 * null means "not in it". That null case covers two different situations on
 * the caller's side (never assigned to any section, or assigned to a
 * DIFFERENT one) — this component cannot tell them apart and does not need
 * to; `TripRouteEditorPage` decides which value to pass by comparing
 * `stop.routeId` against the section it is editing.
 *
 * Every toggle sends the COMPLETE ordered id list `toursApi.assignStops`
 * expects (see `lib/api/tours.ts` — it replaces the section's entire
 * membership, so a partial list would silently drop every other stop out of
 * the section). Switching a stop OFF removes it from the current order;
 * switching one ON appends it at the end — there is no reorder control in
 * this task, only append/remove.
 *
 * A stop without a coordinate (`lat === null || lon === null`) can never
 * join a section (the server rejects it with 400 — `tourRoutes.ts`'s
 * `PUT .../stops` handler), so its switch is disabled up front rather than
 * left to fail round-trip, and the reason is spelled out inline instead of
 * only in a toast the user might miss.
 */
export default function TourStopAssigner({ stops, onChange }: Props): JSX.Element {
  const { t } = useTranslation();

  const orderedIds = [...stops]
    .filter((s) => s.routeOrderIdx !== null)
    .sort((a, b) => (a.routeOrderIdx ?? 0) - (b.routeOrderIdx ?? 0))
    .map((s) => s.id);

  const handleToggle = (stop: TourStop): void => {
    const isAssigned = stop.routeOrderIdx !== null;
    const next = isAssigned ? orderedIds.filter((id) => id !== stop.id) : [...orderedIds, stop.id];
    onChange(next);
  };

  // A trip with no stops at all renders as a bare heading otherwise — the
  // sibling `TourLegList` explains its own empty state, and a section that
  // says nothing leaves the user with no way to learn that stops come from
  // the trip journal first. Found in browser UAT, not by a test.
  if (stops.length === 0) {
    return <p className="text-sm text-(--text-muted)">{t("trips:tours.noStops")}</p>;
  }

  return (
    <ul className="space-y-1">
      {stops.map((stop) => {
        const disabled = stop.lat === null || stop.lon === null;
        const checked = stop.routeOrderIdx !== null;
        return (
          <li
            key={stop.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-(--color-border) px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <span className="truncate font-medium">{stop.title}</span>
              {checked && (
                <span className="ml-2 rounded-sm bg-(--bg-surface) px-1.5 py-0.5 text-xs text-(--text-muted)">
                  {t("trips:tours.stopIsRoutePoint")} #{(stop.routeOrderIdx ?? 0) + 1}
                </span>
              )}
              {disabled && (
                <p className="text-xs text-(--text-muted)">{t("trips:tours.needsCoordinate")}</p>
              )}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={checked}
              aria-label={stop.title}
              disabled={disabled}
              onClick={() => handleToggle(stop)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-hidden disabled:opacity-40 ${
                checked ? "bg-(--accent)" : "bg-gray-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  checked ? "translate-x-4" : "translate-x-1"
                }`}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
