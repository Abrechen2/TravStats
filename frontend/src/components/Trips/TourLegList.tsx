import { useTranslation } from "../../hooks/useTranslation";
import type { LegSource, TourLeg } from "../../types/tour";

/**
 * Only the two sources the API accepts today (see `legOverrideSchema`'s
 * `PHASE_1_SOURCES` in `backend/src/schemas/tour.ts`). `routed` and `track`
 * already exist in `LEG_SOURCES` for a later phase, but offering them here
 * would let a user pick an option the server always rejects with 400.
 */
const PHASE_1_LEG_SOURCES: readonly LegSource[] = ["straight", "drawn"];

interface Props {
  legs: TourLeg[];
  stopTitleById: ReadonlyMap<string, string>;
  onSetSource: (leg: TourLeg, source: LegSource) => void;
  onClear: (leg: TourLeg) => void;
}

function formatKm(value: number): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

/**
 * One row per leg between two consecutive route stops. The source
 * `<select>` is a real, live control — picking "drawn" without an actual
 * drawn line is a legitimate user action that the SERVER rejects (400, "A
 * drawn leg needs at least two waypoints"), because this task ships no
 * line-drawing tool yet (Phase 3). That rejection surfaces as a toast from
 * the page, same as any other write failure here — never silently ignored,
 * and never faked by tagging a straight chord "drawn" just to avoid the
 * error.
 */
export default function TourLegList({
  legs,
  stopTitleById,
  onSetSource,
  onClear,
}: Props): JSX.Element {
  const { t } = useTranslation();

  if (legs.length === 0) {
    return <p className="text-sm text-(--text-muted)">{t("trips:tours.noLegs")}</p>;
  }

  return (
    <ul className="space-y-2">
      {legs.map((leg) => (
        <li
          key={leg.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-(--color-border) p-3 text-sm"
        >
          <span className="min-w-0 flex-1 truncate">
            {stopTitleById.get(leg.fromStopId) ?? "?"} → {stopTitleById.get(leg.toStopId) ?? "?"}
          </span>
          <span className="rounded-sm bg-(--bg-surface) px-1.5 py-0.5 text-xs">
            {t(`trips:tours.mode.${leg.mode}`)}
          </span>
          <span className="text-(--text-muted)">{formatKm(leg.distanceKm)} km</span>
          <select
            value={leg.source}
            onChange={(e) => onSetSource(leg, e.target.value as LegSource)}
            className="rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-xs"
          >
            {PHASE_1_LEG_SOURCES.map((source) => (
              <option key={source} value={source}>
                {t(`trips:tours.source.${source}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={leg.source === "straight"}
            className="text-xs underline disabled:opacity-40 disabled:no-underline"
            onClick={() => onClear(leg)}
          >
            {t("trips:tours.clearLeg")}
          </button>
        </li>
      ))}
    </ul>
  );
}
