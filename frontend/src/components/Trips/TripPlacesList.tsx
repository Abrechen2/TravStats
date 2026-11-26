import Chip from "../ui/Chip";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useScrollToHash } from "../../hooks/useScrollToHash";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { usePlaceCategories } from "../../hooks/usePlaceCategories";
import { usePlacesVisible } from "../../hooks/usePlacesVisible";
import type { TripPlaceVisits, TripPlaceVisit } from "../../hooks/useTripPlaceVisits";
import { formatDate } from "../../lib/displayFormat";
import { visitTime } from "../../lib/entityTimes";
import { placeCategoryIcon } from "../../lib/placeCategoryDisplay";
import { classifyVisit } from "../../shared/placeCounting";
import { PanelHeader } from "./TripDetailPanels";
import { TripPlacesError } from "./TripPlacesStatus";

/** The anchor the trip head's "N Orte" link scrolls to. */
export const TRIP_PLACES_ANCHOR = "trip-places";

/** Max height of the scroll area; the panel scrolls itself so a 40-place trip does not push the page. */
const LIST_MAX_HEIGHT = "min(60vh, 28rem)";

interface DayGroup {
  day: string | null;
  rows: TripPlaceVisit[];
}

/** The visit's day on the place's own calendar, `YYYY-MM-DD`, or null when it is undated. */
function visitDay(visit: TripPlaceVisit["visit"]): string | null {
  return visitTime(visit)?.local?.slice(0, 10) ?? null;
}

/** Day by day, oldest first, undated visits last; within a day by the visit's order. */
export function groupByDay(placeVisits: readonly TripPlaceVisit[]): DayGroup[] {
  const byDay = new Map<string | null, TripPlaceVisit[]>();
  for (const pv of placeVisits) {
    const day = visitDay(pv.visit);
    byDay.set(day, [...(byDay.get(day) ?? []), pv]);
  }
  return [...byDay]
    .sort(([a], [b]) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1))
    .map(([day, rows]) => ({
      day,
      rows: [...rows].sort((x, y) => x.visit.orderIdx - y.visit.orderIdx),
    }));
}

/**
 * "Besuchte Orte" on the trip's overview: every place visit of the trip as a
 * scrollable list. Visits still in the future are marked planned — the head
 * count stays "visited" only (the one counting rule, `classifyVisit`).
 */
export default function TripPlacesList({
  places,
}: {
  places: TripPlaceVisits;
}): JSX.Element | null {
  const { t } = useTranslation(["trips"]);
  const visible = usePlacesVisible();
  const coarse = useCoarsePointer();
  const { customs } = usePlaceCategories();
  // The head's "N Orte" link lands here (…?tab=overview#trip-places).
  useScrollToHash(visible && !places.loading);

  if (!visible) return null;

  const groups = groupByDay(places.placeVisits);
  const rowPad = coarse ? "py-3.5" : "py-2.5";

  return (
    <section
      id={TRIP_PLACES_ANCHOR}
      data-testid="trip-places-panel"
      className="rounded-xl scroll-mt-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <PanelHeader>
        {t("trips:overview.places.title")}
        {!places.failed && places.placeVisits.length > 0 && ` (${places.placeVisits.length})`}
      </PanelHeader>
      {places.failed ? (
        <div className="px-4 pt-3">
          <TripPlacesError onRetry={places.reload} />
        </div>
      ) : places.loading ? (
        <p className="px-4 py-3 text-sm text-(--text-muted)">
          {t("trips:overview.places.loading")}
        </p>
      ) : groups.length === 0 ? (
        <p data-testid="trip-places-empty" className="px-4 py-3 text-sm text-(--text-muted)">
          {t("trips:overview.places.empty")}
        </p>
      ) : (
        <div
          data-testid="trip-places-scroll"
          className="overflow-y-auto"
          style={{ maxHeight: LIST_MAX_HEIGHT }}
        >
          {groups.map((g) => (
            <div key={g.day ?? "undated"}>
              <div
                className="px-4 py-1.5 text-xs"
                style={{ background: "var(--ts-surface2)", color: "var(--text-muted)" }}
              >
                {g.day ? formatDate(g.day) : t("trips:overview.places.undated")}
              </div>
              <ul>
                {g.rows.map(({ place, visit }) => {
                  const planned = classifyVisit(visit) === "planned";
                  return (
                    <li key={visit.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <Link
                        to={`/places/${place.id}`}
                        className={`flex items-center gap-3 px-4 ${rowPad} hover:bg-[var(--ts-surface2)]`}
                      >
                        <span aria-hidden="true" className="shrink-0 text-lg">
                          {placeCategoryIcon(place.category, customs)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {place.name}
                        </span>
                        {planned && (
                          <Chip testId="trip-place-planned" size="sm" className="shrink-0">
                            {t("trips:overview.places.planned")}
                          </Chip>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
