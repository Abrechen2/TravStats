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
 * One row per leg between two consecutive route stops.
 *
 * The source `<select>` never offers an option the server would reject.
 * "drawn" is offered ONLY when the leg already has a stored line
 * (`leg.waypoints !== null`) — the "keep the line I have, or revert to
 * straight" case, which always succeeds. A leg with no line yet has no
 * way to become "drawn" from this page (no line-drawing tool exists —
 * Phase 3), so its only option is "straight" and the select is disabled
 * (nothing to switch to); a hint explains why rather than leaving the
 * control looking broken. Fix round 1 of Task 14: the first version of
 * this control offered "drawn" unconditionally and let the server's 400
 * be the only feedback — technically honest, but a control whose only
 * possible outcome is an error is a broken control, not an honest one.
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
      {legs.map((leg) => {
        const hasLine = leg.waypoints !== null && leg.waypoints.length >= 2;
        const availableSources: readonly LegSource[] = hasLine
          ? PHASE_1_LEG_SOURCES
          : ["straight"];
        return (
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
              disabled={availableSources.length < 2}
              onChange={(e) => onSetSource(leg, e.target.value as LegSource)}
              className="rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-xs disabled:opacity-40"
            >
              {availableSources.map((source) => (
                <option key={source} value={source}>
                  {t(`trips:tours.source.${source}`)}
                </option>
              ))}
            </select>
            {!hasLine && (
              <span className="text-xs text-(--text-muted)">{t("trips:tours.noLineYet")}</span>
            )}
            <button
              type="button"
              disabled={leg.source === "straight"}
              className="text-xs underline disabled:opacity-40 disabled:no-underline"
              onClick={() => onClear(leg)}
            >
              {t("trips:tours.clearLeg")}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
