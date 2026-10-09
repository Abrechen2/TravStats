import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import ListLoadFailed, { loadFailureLog } from "../components/table/ListLoadFailed";
import { SkeletonTable } from "../components/SkeletonLoader";
import { RowActionButton } from "../components/table/RowActionButton";
import { VisitDialog } from "../components/places/VisitDialog";
import {
  NearbyOriginPicker,
  type ChosenOrigin,
  type OriginMode,
} from "../components/places/NearbyOriginPicker";
import {
  DEFAULT_RADIUS_KM,
  NEARBY_RADII_KM,
  nearbyPlaces,
  widerRadius,
} from "../components/places/placesNearbyModel";
import { useTranslation } from "../hooks/useTranslation";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { listPlaces } from "../lib/api/places";
import { listLodgings } from "../lib/api/lodging";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import { PLACE_CATEGORIES, PLACE_CATEGORY_ICONS } from "../shared/placeCategories";
import type { PlaceCategory } from "../shared/placeCategories";
import type { PlaceCountState } from "../shared/placeCounting";
import type { Lodging } from "../types/lodging";
import type { Place } from "../types/place";

const COARSE = "pointer-coarse:min-h-(--ts-size-touch-min)";
const ALL_STATES: readonly PlaceCountState[] = ["visited", "planned", "excluded"];

/**
 * Each state reads by SHAPE and WORD, not by colour alone (forgejo#233): a
 * filled tick for "been there", a clock for "planned", a hollow star for
 * "saved, not yet". The tint only repeats what the word already says.
 */
const STATE_MARK: Record<PlaceCountState, { glyph: string; color: string }> = {
  visited: { glyph: "✓", color: "var(--ts-good, var(--success))" },
  planned: { glyph: "◷", color: "var(--ts-warn)" },
  excluded: { glyph: "☆", color: "var(--text-muted)" },
};

/**
 * "Was habe ich mir hier gemerkt?" — the user's own places around a lodging,
 * a point on the map, or (optionally, once) where the device is
 * (forgejo#233). Filtered by distance, category and state; visited, planned
 * and saved places are told apart by mark and word.
 *
 * `?lodging=<id>` or `?lat=…&lon=…` open it at a start, so a lodging page or
 * a bookmark can link here. The device's position is never written there.
 */
export default function PlacesNearbyPage(): JSX.Element {
  const { t, i18n } = useTranslation(["places", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const { isEnabled } = useEnabledDomains();
  const lodgingEnabled = isEnabled("lodging");
  const [params, setParams] = useSearchParams();

  const [places, setPlaces] = useState<Place[] | null>(null);
  const [placesFailure, setPlacesFailure] = useState<string | null | false>(false);
  const [lodgings, setLodgings] = useState<Lodging[] | null>(null);
  const [lodgingsFailed, setLodgingsFailed] = useState(false);

  const [mode, setMode] = useState<OriginMode>(() =>
    params.get("lat") !== null ? "point" : lodgingEnabled ? "lodging" : "point"
  );
  const [origin, setOrigin] = useState<ChosenOrigin | null>(() => pointFromParams(params));
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  const [category, setCategory] = useState<PlaceCategory | "all">("all");
  const [states, setStates] = useState<ReadonlySet<PlaceCountState>>(new Set(ALL_STATES));
  const [recordingFor, setRecordingFor] = useState<Place | null>(null);

  const loadPlaces = useCallback(async (): Promise<void> => {
    setPlacesFailure(false);
    try {
      setPlaces(await listPlaces({}));
    } catch (err: unknown) {
      logger.error({ err }, "PlacesNearbyPage: could not load places");
      setPlacesFailure(loadFailureLog(err));
    }
  }, []);

  const loadLodgings = useCallback(async (): Promise<void> => {
    setLodgingsFailed(false);
    try {
      setLodgings(await listLodgings());
    } catch (err: unknown) {
      logger.error({ err }, "PlacesNearbyPage: could not load lodgings");
      setLodgingsFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadPlaces();
  }, [loadPlaces]);
  useEffect(() => {
    if (lodgingEnabled) void loadLodgings();
  }, [lodgingEnabled, loadLodgings]);

  // A `?lodging=` link resolves once the lodgings are there.
  const linkedLodging = params.get("lodging");
  // A linked lodging that cannot be a start — gone, without a position, or the
  // lodging domain is off — is said, not silently ignored (review M5).
  const [linkUnusable, setLinkUnusable] = useState(false);
  useEffect(() => {
    if (linkedLodging === null || origin !== null) return;
    if (!lodgingEnabled) {
      setLinkUnusable(true);
      return;
    }
    if (lodgings === null) return;
    const found = lodgings.find((l) => l.id === linkedLodging);
    if (!found || found.lat === null || found.lon === null) {
      setLinkUnusable(true);
      return;
    }
    setMode("lodging");
    setOrigin({
      mode: "lodging",
      lodgingId: found.id,
      lat: found.lat,
      lon: found.lon,
      label: found.name,
    });
  }, [linkedLodging, lodgings, origin, lodgingEnabled]);

  const chooseOrigin = (next: ChosenOrigin): void => {
    setOrigin(next);
    setLinkUnusable(false);
    // Lodging and map point are shareable starts; the device's position is
    // not, and is kept out of the address bar on purpose.
    if (next.mode === "lodging" && next.lodgingId) {
      setParams({ lodging: next.lodgingId }, { replace: true });
    } else if (next.mode === "point") {
      setParams({ lat: next.lat.toFixed(5), lon: next.lon.toFixed(5) }, { replace: true });
    } else {
      setParams({}, { replace: true });
    }
  };

  const rows = useMemo(
    () =>
      origin === null || places === null
        ? []
        : nearbyPlaces(places, origin, { radiusKm, category, states }),
    [origin, places, radiusKm, category, states]
  );
  const narrowed = category !== "all" || states.size < ALL_STATES.length;
  const wider = widerRadius(radiusKm);

  const distance = (km: number): string => {
    const fmt = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: km < 10 ? 1 : 0 });
    return km < 1
      ? t("places:nearby.metres", { value: Math.round(km * 1000) })
      : t("places:nearby.kilometres", { value: fmt.format(km) });
  };

  const toggleState = (s: PlaceCountState): void =>
    setStates((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  return (
    <AppShell width="list">
      <Link to="/places" className="ts-back-link text-sm">
        ← {t("places:detail.backToLogbook")}
      </Link>
      <h1 className="t-screen-title mt-2 mb-1">{t("places:nearby.title")}</h1>
      <p className="mb-5 text-sm" style={{ color: "var(--text-muted)" }}>
        {t("places:nearby.subtitle")}
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="flex flex-col gap-5">
          {linkUnusable && (
            <p role="alert" className="text-sm" style={{ color: "var(--ts-warn)" }}>
              {t("places:nearby.origin.linkedLodgingUnusable")}
            </p>
          )}
          <NearbyOriginPicker
            mode={mode}
            onModeChange={setMode}
            origin={origin}
            onOrigin={chooseOrigin}
            lodgings={lodgings}
            lodgingsFailed={lodgingsFailed}
            onRetryLodgings={() => void loadLodgings()}
            lodgingEnabled={lodgingEnabled}
          />

          <section aria-labelledby="nearby-filter" className="flex flex-col gap-3">
            <h2 id="nearby-filter" className="t-label-mono">
              {t("places:nearby.filter.title")}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="nearby-radius" className="t-caption">
                  {t("places:nearby.filter.radius")}
                </label>
                <select
                  id="nearby-radius"
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value))}
                  className={`rounded-md border border-[var(--color-border)] bg-[var(--bg-base)] px-3 py-2 text-sm ${COARSE}`}
                >
                  {NEARBY_RADII_KM.map((r) => (
                    <option key={r} value={r}>
                      {distance(r)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="nearby-category" className="t-caption">
                  {t("places:list.filters.category")}
                </label>
                <select
                  id="nearby-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as PlaceCategory | "all")}
                  className={`rounded-md border border-[var(--color-border)] bg-[var(--bg-base)] px-3 py-2 text-sm ${COARSE}`}
                >
                  <option value="all">{t("places:filter.allCategories")}</option>
                  {PLACE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`places:categories.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <fieldset>
              <legend className="t-caption mb-1">{t("places:nearby.filter.states")}</legend>
              <div className="flex flex-wrap gap-2">
                {ALL_STATES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={states.has(s)}
                    onClick={() => toggleState(s)}
                    className={`rounded-full px-3 py-1.5 text-sm ${COARSE}`}
                    style={{
                      border: states.has(s)
                        ? `1px solid ${STATE_MARK[s].color}`
                        : "1px dashed var(--color-border)",
                      color: states.has(s) ? "var(--text-primary)" : "var(--text-muted)",
                    }}
                  >
                    <span aria-hidden style={{ color: STATE_MARK[s].color }}>
                      {STATE_MARK[s].glyph}
                    </span>{" "}
                    {t(`places:nearby.state.${s}`)}
                  </button>
                ))}
              </div>
            </fieldset>
          </section>
        </div>

        <section aria-labelledby="nearby-results" className="flex flex-col gap-3">
          <h2 id="nearby-results" className="t-label-mono">
            {origin === null
              ? t("places:nearby.results.title")
              : t("places:nearby.results.count", {
                  count: rows.length,
                  radius: distance(radiusKm),
                  label: origin.label,
                })}
          </h2>
          {placesFailure !== false ? (
            <ListLoadFailed
              title={t("places:list.loadError")}
              onRetry={() => void loadPlaces()}
              log={placesFailure}
            />
          ) : places === null ? (
            <SkeletonTable rows={5} />
          ) : origin === null ? (
            <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              {t("places:nearby.results.noOrigin")}
            </p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center text-sm">
              <p style={{ color: "var(--text-muted)" }}>
                {narrowed
                  ? t("places:nearby.results.noneFiltered")
                  : t("places:nearby.results.none", { radius: distance(radiusKm) })}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {narrowed && (
                  <button
                    type="button"
                    onClick={() => {
                      setCategory("all");
                      setStates(new Set(ALL_STATES));
                    }}
                    className={`rounded-lg px-4 py-2 ${COARSE}`}
                    style={{ border: "1px solid var(--color-border)" }}
                  >
                    {t("common:filters.reset")}
                  </button>
                )}
                {wider !== null && (
                  <button
                    type="button"
                    onClick={() => setRadiusKm(wider)}
                    className={`rounded-lg px-4 py-2 ${COARSE}`}
                    style={{ border: "1px solid var(--color-border)" }}
                  >
                    {t("places:nearby.results.wider", { radius: distance(wider) })}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <ul className="grid gap-2" style={{ listStyle: "none", padding: 0 }}>
              {rows.map(({ place, km, state }) => (
                <li
                  key={place.id}
                  className="flex items-center gap-3 rounded-xl px-4 py-3"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <span aria-hidden>{PLACE_CATEGORY_ICONS[place.category]}</span>
                  <Link
                    to={`/places/${place.id}`}
                    className="min-w-0 flex-1 truncate text-sm"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {place.name}
                  </Link>
                  <span className="t-caption shrink-0 tabular-nums">{distance(km)}</span>
                  <span
                    className="ts-status-pill shrink-0"
                    style={{
                      color: STATE_MARK[state].color,
                      borderStyle: state === "excluded" ? "dashed" : "solid",
                    }}
                  >
                    <span aria-hidden>{STATE_MARK[state].glyph}</span>{" "}
                    {t(`places:nearby.state.${state}`)}
                  </span>
                  <RowActionButton
                    icon="checkIn"
                    label={t("places:visit.action")}
                    onClick={() => setRecordingFor(place)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {recordingFor && (
        <VisitDialog
          place={recordingFor}
          onClose={() => setRecordingFor(null)}
          onSaved={async () => {
            setPlaces(await listPlaces({}));
            addToast("success", t("places:visit.recorded", { name: recordingFor.name }));
            setRecordingFor(null);
          }}
        />
      )}
    </AppShell>
  );
}

/** A `?lat=…&lon=…` start, when the address carries a valid one. */
function pointFromParams(params: URLSearchParams): ChosenOrigin | null {
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (params.get("lat") === null || params.get("lon") === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { mode: "point", lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
}
