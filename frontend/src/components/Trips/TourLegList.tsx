import { useTranslation } from "../../hooks/useTranslation";
import { isRoutableLegMode, type LegSource, type TourLeg } from "../../types/tour";

/**
 * The sources the MANUAL override endpoint accepts (see `MANUAL_LEG_SOURCES`
 * in `backend/src/schemas/tour.ts`). `routed` is deliberately excluded here —
 * it is never sent through `onSetSource`/the manual override endpoint, only
 * through `onRoute`/the routing endpoint (`POST .../route`). `track` is ALSO
 * excluded: it goes through `onAdoptTrack`/the same override endpoint's
 * discriminated `track` branch, which needs a `trackId` this type has no
 * room for.
 */
type ManualLegSource = "straight" | "drawn";

interface LegSourceOption {
  source: LegSource;
  disabled: boolean;
}

interface Props {
  legs: TourLeg[];
  stopTitleById: ReadonlyMap<string, string>;
  /** Whether a routing provider is configured and usable right now — see
   *  `routingAvailable` on `toursApi.get()`. Gates the "routed" option per
   *  leg AND the "route the whole tour" button; "straight"/"drawn" work
   *  regardless. The button used to ignore this, which let the batch run
   *  with no provider: every leg fell back to its straight chord and the
   *  toast still reported them as routed. Found in browser UAT. */
  routingAvailable: boolean;
  onSetSource: (leg: TourLeg, source: ManualLegSource) => void;
  /** Routes ONE leg through the configured provider. Only ever invoked for
   *  a leg whose "routed" option is enabled — never for a disabled or
   *  absent one, since the control itself prevents that selection. */
  onRoute: (leg: TourLeg) => void;
  /**
   * legId -> id of the recorded track that covers it (phase 3b, task 8).
   * Absent for a leg no uploaded track comes within anchor tolerance of —
   * see `lib/trackCoverage.ts`. Gates the "track" option the same way
   * `routingAvailable` gates "routed": never offered as usable unless a
   * concrete track id is already known to cover this exact leg, because
   * selecting it with no covering track can only 409.
   */
  trackCoverageByLegId: ReadonlyMap<string, string>;
  /**
   * Whether the track list has actually finished loading, successfully —
   * i.e. `!tracksLoading && !tracksLoadError` from `useTourTracks`. An
   * absent `trackCoverageByLegId` entry means "no candidate" in FOUR
   * different situations (see that hook's own doc comment): genuinely no
   * covering track, the list is still loading, the list failed to load, or
   * one track's own geometry fetch failed. Only the first of those is a
   * real "no track covers this leg"; the other three are an unknown state,
   * not a negative match, and must not render the same definitive hint.
   */
  tracksKnown: boolean;
  /** Adopts the covering track's geometry onto this leg. Only ever invoked
   *  for a leg whose "track" option is enabled, with the trackId this
   *  component already resolved from `trackCoverageByLegId` — never a
   *  caller-guessed one. */
  onAdoptTrack: (leg: TourLeg, trackId: string) => void;
  onClear: (leg: TourLeg) => void;
  /** Routes every routable leg of the section in one call. */
  onRouteAll: () => void;
  /** Disables the "route the whole section" button while a batch request
   *  is in flight, and swaps its label to a busy state. */
  routingAllInProgress?: boolean;
}

function formatKm(value: number): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

/**
 * Which sources this leg's `<select>` may offer, and whether each is
 * actually usable right now.
 *
 * "drawn" is offered ONLY when the leg already has a stored line
 * (`leg.waypoints !== null`) — the "keep the line I have, or revert to
 * straight" case, which always succeeds. A leg with no line yet has no way
 * to become "drawn" from this page (no line-drawing tool exists — Phase 3),
 * so it is left out entirely rather than offered disabled.
 *
 * "routed" is offered ONLY for a routable mode (`isRoutableLegMode`) — a
 * ferry or rail leg never shows it at all, because no provider can
 * meaningfully answer either (see `isRoutableLegMode`'s own doc comment).
 * When the mode IS routable but no provider is configured
 * (`!routingAvailable`), the option is still shown but DISABLED, with the
 * reason surfaced as a hint below the select — never silently omitted,
 * so a traveller who wants routing knows it exists and why it does not
 * work yet, rather than wondering if the feature is missing.
 *
 * Fix round 1 of Task 14 already established the rule this follows: a
 * control whose only possible outcome is an error is a broken control, not
 * an honest one. Task 7 extends the same rule to "routed" — never offer it
 * where selecting it can only 409. Phase 3b's task 8 extends it a second
 * time to "track": always shown (any leg mode may have been recorded, not
 * only a routable one — unlike "routed" this has no mode restriction), but
 * disabled unless `coveringTrackId` is already known, exactly the same
 * shape.
 */
function buildOptions(
  leg: TourLeg,
  routingAvailable: boolean,
  coveringTrackId: string | undefined
): LegSourceOption[] {
  const hasLine = leg.waypoints !== null && leg.waypoints.length >= 2;
  const options: LegSourceOption[] = [{ source: "straight", disabled: false }];
  if (hasLine) {
    options.push({ source: "drawn", disabled: false });
  }
  if (isRoutableLegMode(leg.mode)) {
    options.push({ source: "routed", disabled: !routingAvailable });
  }
  options.push({ source: "track", disabled: coveringTrackId === undefined });
  return options;
}

/**
 * One row per leg between two consecutive route stops, plus a header
 * action to route every routable leg of the section at once.
 */
export default function TourLegList({
  legs,
  stopTitleById,
  routingAvailable,
  onSetSource,
  onRoute,
  trackCoverageByLegId,
  tracksKnown,
  onAdoptTrack,
  onClear,
  onRouteAll,
  routingAllInProgress = false,
}: Props): JSX.Element {
  const { t } = useTranslation();

  if (legs.length === 0) {
    return <p className="text-sm text-(--text-muted)">{t("trips:tours.noLegs")}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          disabled={routingAllInProgress || !routingAvailable}
          title={routingAvailable ? undefined : t("trips:tours.routing.unavailableReason")}
          className="rounded-sm border border-(--color-border) px-3 py-1.5 text-xs hover:bg-(--bg-surface) disabled:opacity-40"
          onClick={onRouteAll}
        >
          {routingAllInProgress
            ? t("trips:tours.routing.routingAll")
            : t("trips:tours.routing.routeAll")}
        </button>
      </div>
      <ul className="space-y-2">
        {legs.map((leg) => {
          const hasLine = leg.waypoints !== null && leg.waypoints.length >= 2;
          const isRoutable = isRoutableLegMode(leg.mode);
          const coveringTrackId = trackCoverageByLegId.get(leg.id);
          const options = buildOptions(leg, routingAvailable, coveringTrackId);
          const enabledCount = options.filter((o) => !o.disabled).length;
          return (
            <li
              key={leg.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-(--color-border) p-3 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {stopTitleById.get(leg.fromStopId) ?? "?"} →{" "}
                {stopTitleById.get(leg.toStopId) ?? "?"}
              </span>
              <span className="rounded-sm bg-(--bg-surface) px-1.5 py-0.5 text-xs">
                {t(`trips:tours.mode.${leg.mode}`)}
              </span>
              <span className="text-(--text-muted)">{formatKm(leg.distanceKm)} km</span>
              <select
                value={leg.source}
                disabled={enabledCount < 2}
                onChange={(e) => {
                  const value = e.target.value as LegSource;
                  if (value === "routed") {
                    onRoute(leg);
                  } else if (value === "track") {
                    // The option is disabled whenever `coveringTrackId` is
                    // `undefined` (see `buildOptions`), so a `<select>`
                    // change event can only carry this value when it is
                    // defined — but the guard stays here rather than
                    // asserting, so a future bug in that gating logs a
                    // silent no-op instead of adopting a track that was
                    // never actually confirmed to cover this leg.
                    if (coveringTrackId !== undefined) onAdoptTrack(leg, coveringTrackId);
                  } else {
                    onSetSource(leg, value as ManualLegSource);
                  }
                }}
                className="rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-xs disabled:opacity-40"
              >
                {options.map((option) => (
                  <option key={option.source} value={option.source} disabled={option.disabled}>
                    {t(`trips:tours.source.${option.source}`)}
                  </option>
                ))}
              </select>
              {!hasLine && (
                <span className="text-xs text-(--text-muted)">{t("trips:tours.noLineYet")}</span>
              )}
              {isRoutable && !routingAvailable && (
                <span className="text-xs text-(--text-muted)">
                  {t("trips:tours.routing.unavailableReason")}
                </span>
              )}
              {coveringTrackId === undefined && tracksKnown && leg.source !== "track" && (
                <span className="text-xs text-(--text-muted)">
                  {t("trips:tours.tracks.noCoverageReason")}
                </span>
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
    </div>
  );
}
