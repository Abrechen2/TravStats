import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import { useIsPhoneViewport } from "../../../hooks/useIsPhoneViewport";
import { useTodayZone } from "../../../hooks/useTodayZone";
import type { Feature, Geometry } from "geojson";
import type { TrackPoint } from "../../../lib/api/travtrack";
import type { TravTrackFlightPanel, TravTrackPhoto } from "../../../lib/api/travtrackViews";
import { todayIn } from "../../../shared/time/clock";
import TrackDeleteDialog from "../TrackDeleteDialog";
import TrackExportDialog from "../TrackExportDialog";
import TrackLegCard from "./TrackLegCard";
import TrackStopCard from "./TrackStopCard";
import TrackFlightPanel, { type SelectedFlight } from "../flight/TrackFlightPanel";
import TrackPhotoNotice from "../photos/TrackPhotoNotice";
import TrackPhotoThumb from "../photos/TrackPhotoThumb";
import { photoWindowOf } from "../photos/trackPhotos";
import { useTrackPhotos } from "../photos/useTrackPhotos";
import TrackCountriesNotice from "../countries/TrackCountriesNotice";
import { useVisitedCountries } from "../countries/useVisitedCountries";
import type { FogStatus } from "./TrackFogLayer";
import TrackLayersPanel from "./TrackLayersPanel";
import TrackMapAside from "./TrackMapAside";
import TrackMapNotices from "./TrackMapNotices";
import TrackPointInspector from "./TrackPointInspector";
import TrackRangeBar from "./TrackRangeBar";
import TrackRangeMap from "./TrackRangeMap";
import TrackReplayBar from "./TrackReplayBar";
import { lonLat, rangeTotals, splitAfterPause, type LonLat } from "./trackGeometry";
import {
  legFitPadding,
  legFrame,
  legLines,
  totalsFromAggregates,
  type TrackSelection,
} from "./trackLegs";
import { mapAnchors, type MapLegLine, type MapPoint, type MapStop } from "./trackMapLayers";
import { useTrackMapPrefs } from "./trackMapPrefs";
import { panelStyle } from "./trackMapStyle";
import type { DayResult } from "./trackRange";
import {
  REPLAY_MAX_DAYS,
  parseSpan,
  presetSpan,
  spanDays,
  spanPath,
  stepSpan,
  type TrackSpan,
} from "./trackSpan";
import { clipSegments, cutToWindow, replayPositions, type ReplaySpan } from "./trackReplay";
import { filterByAccuracy, speedStopsFor } from "./trackSpeedScale";
import { useFlightTrack } from "./useFlightTrack";
import { useLiveFollow } from "./useLiveFollow";
import { useReplay } from "./useReplay";
import { useTrackMapData } from "./useTrackMapData";
import WebGLGuard from "../../../components/map/WebGLGuard";

type Loaded = Extract<DayResult, { kind: "loaded" }>;

/** No stretches for the replay of a span longer than it plays. */
const NO_STRETCHES: TrackPoint[][] = [];
const NO_SHAPES: Feature<Geometry>[] = [];
const NO_LINES: LonLat[][] = [];
const NO_LEG_LINES: MapLegLine[] = [];
const NO_POINTS: MapPoint[] = [];

/** A flight named only by its id (a link): the panel reads its label from the server. */
const flightById = (id: string): SelectedFlight => ({ id, label: "", href: `/flights/${id}` });

/** The instants the open panel's series covers, for the map's flight line. */
function seriesWindow(
  panel: TravTrackFlightPanel | null
): { fromMs: number; untilMs: number } | null {
  const all = panel?.series.flat() ?? [];
  if (all.length < 2) return null;
  return { fromMs: all[0][0], untilMs: all[all.length - 1][0] + 1 };
}

const toLines = (segments: readonly TrackPoint[][]) =>
  segments.filter((s) => s.length > 1).map((s): LonLat[] => s.map(lonLat));

/**
 * The „Karte" tab of `/track` (TravTrack plan T5.2 + T5.3, board „Track-Karte"):
 * a range bar from one day to a year or a picked Zeitraum, the layers and route
 * panel, the map with its replay (up to seven days), photos on the track, the
 * point inspector with its delete, the flight panel, and the span's totals
 * beside the coverage and the logbook's timeline. Everything is drawn from
 * safe stretches; a day or a part that failed says so and is never drawn as
 * empty. Private zones are not drawn.
 */
export default function TrackMapView(): JSX.Element {
  const { t } = useTranslation(["track"]);
  const phone = useIsPhoneViewport();
  const navigate = useNavigate();
  const params = useParams<{ date?: string }>();
  const [search, setSearch] = useSearchParams();
  const flightParam = search.get("flight");
  const profileZone = useTodayZone();
  const today = todayIn(profileZone);
  const span = useMemo(() => parseSpan(params.date, search, today), [params.date, search, today]);
  const [generation, setGeneration] = useState(0);
  const data = useTrackMapData(span, generation);
  const { long, days, dayResults, source, loading } = data;
  const [prefs, setPrefs, prefsSaveFailed] = useTrackMapPrefs();
  const [dialog, setDialog] = useState<"export" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [pick, setPick] = useState<TrackSelection | null>(null);
  const [photo, setPhoto] = useState<TravTrackPhoto | null>(null);
  // "Play this leg": the replay is limited to this window until it is reset.
  const [replayWindow, setReplayWindow] = useState<ReplaySpan | null>(null);
  // "Show its points": the leg (date + id) whose vertices are drawn as markers.
  const [pointsOf, setPointsOf] = useState<string | null>(null);
  const [flight, setFlightState] = useState<SelectedFlight | null>(() =>
    flightParam ? flightById(flightParam) : null
  );
  const [flightPanel, setFlightPanel] = useState<TravTrackFlightPanel | null>(null);
  // `?flight=` opens the panel (a link from the flight's page); back and forward follow it.
  useEffect(() => {
    setFlightState((current) =>
      flightParam === null ? null : current?.id === flightParam ? current : flightById(flightParam)
    );
    setFlightPanel((panel) => (panel?.flightId === flightParam ? panel : null));
  }, [flightParam]);
  const setFlight = useCallback(
    (next: SelectedFlight | null) => {
      setFlightState(next);
      setFlightPanel(null);
      setSearch(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next) params.set("flight", next.id);
          else params.delete("flight");
          return params;
        },
        { replace: true }
      );
    },
    [setSearch]
  );
  const [fog, setFog] = useState<FogStatus>({ kind: "idle" });
  const [live, setLive] = useState(false);
  const following = live && !long && days.includes(today);
  const liveState = useLiveFollow(following, () => data.refresh(today));
  const short = spanDays(span) <= REPLAY_MAX_DAYS;

  const go = (next: TrackSpan) => {
    setNotice(null);
    setSelected(null);
    setPick(null);
    setPhoto(null);
    setFlight(null);
    setReplayWindow(null);
    setPointsOf(null);
    navigate(spanPath(next, today));
  };

  useEffect(() => {
    if (!prefs.layers.fog) setFog({ kind: "idle" });
  }, [prefs.layers.fog]);

  const loaded = useMemo(
    () => dayResults.filter((r): r is Loaded => r.kind === "loaded"),
    [dayResults]
  );
  const zone = loaded[0]?.day.zone ?? profileZone;

  const shown = useMemo(
    () =>
      splitAfterPause(
        source.segments,
        prefs.splitMinutes === null ? null : prefs.splitMinutes * 60_000
      ),
    [source.segments, prefs.splitMinutes]
  );
  const replayed = useMemo(
    () => (replayWindow ? cutToWindow(shown, replayWindow) : shown),
    [shown, replayWindow]
  );
  const replay = useReplay(short ? replayed : NO_STRETCHES, replayWindow !== null);
  const drawn = useMemo(
    () => (replay.t === null ? shown : clipSegments(replayed, replay.t)),
    [shown, replayed, replay.t]
  );
  const resetReplay = useCallback(() => {
    setReplayWindow(null);
    replay.reset();
  }, [replay]);
  const speedStops = useMemo(
    () => speedStopsFor(prefs.speedScale, shown),
    [prefs.speedScale, shown]
  );
  const frameLines = useMemo(() => toLines(shown), [shown]);
  const lines = useMemo(() => toLines(drawn), [drawn]);
  const head = useMemo(
    () => (replay.t === null ? [] : replayPositions(replayed, replay.t)),
    [replayed, replay.t]
  );
  const points = useMemo<MapPoint[]>(
    () =>
      source.segments.flatMap((segment, i) =>
        segment.map((point, j) => ({
          point,
          zone,
          id: source.ids[i]?.[j] ?? null,
          detail: source.details[i]?.[j] ?? null,
        }))
      ),
    [source, zone]
  );
  const visiblePoints = useMemo(
    () => filterByAccuracy(points, prefs.maxAccuracyM),
    [points, prefs.maxAccuracyM]
  );
  const anchors = useMemo(() => loaded.flatMap((r) => mapAnchors(r.day.context, t)), [loaded, t]);
  const totals = useMemo(
    () =>
      totalsFromAggregates(
        rangeTotals(shown, [{ pointCount: source.positions, coverage: source.coverage }]),
        data.range?.parts ?? []
      ),
    [shown, source, data.range]
  );

  // Legs and stops of the loaded days (a long span has none): clicking one selects it on map and list.
  const legLineList = useMemo<MapLegLine[]>(
    () =>
      loaded.flatMap((r) =>
        (r.day.legs ?? []).flatMap((leg) =>
          legLines(r.day, leg).map((path) => ({ id: leg.id, date: r.date, path }))
        )
      ),
    [loaded]
  );
  const resolved = useMemo(() => {
    if (!pick) return null;
    const day = loaded.find((r) => r.date === pick.date)?.day;
    if (!day) return null;
    if (pick.kind === "leg") {
      const leg = day.legs?.find((l) => l.id === pick.id);
      return leg ? ({ kind: "leg", day, leg } as const) : null;
    }
    const stop = day.stops?.find((s) => s.fromMs === pick.fromMs);
    return stop ? ({ kind: "stop", day, stop } as const) : null;
  }, [pick, loaded]);
  // A pick the day no longer holds (re-derived after late points) is no pick.
  const activePick = resolved ? pick : null;
  // The leg is cut from the whole stretches: while the replay runs it would show what the replay has not reached.
  const replaying = replay.t !== null;
  const selectedLines = useMemo(
    () =>
      resolved?.kind === "leg" && !replaying ? legLines(resolved.day, resolved.leg) : NO_LINES,
    [resolved, replaying]
  );
  const legKey = resolved?.kind === "leg" ? `${resolved.day.date}|${resolved.leg.id}` : null;
  // The leg's own vertices, from the day's stretches its ranges index.
  const legPoints = useMemo<readonly MapPoint[]>(() => {
    if (resolved?.kind !== "leg" || legKey !== pointsOf) return NO_POINTS;
    const { day, leg } = resolved;
    return filterByAccuracy(
      leg.ranges.flatMap((range) =>
        (day.segments[range.segment] ?? []).slice(range.from, range.to + 1).map((point, i) => ({
          point,
          zone: day.zone,
          id: day.pointIds?.[range.segment]?.[range.from + i] ?? null,
          detail: day.pointDetails?.[range.segment]?.[range.from + i] ?? null,
        }))
      ),
      prefs.maxAccuracyM
    );
  }, [resolved, legKey, pointsOf, prefs.maxAccuracyM]);
  const legReplayable = useMemo(
    () =>
      short &&
      resolved?.kind === "leg" &&
      cutToWindow(shown, { fromMs: resolved.leg.fromMs, untilMs: resolved.leg.untilMs }).some(
        (s) => s.length > 1
      ),
    [short, resolved, shown]
  );
  const stopList = useMemo<MapStop[]>(
    () =>
      loaded.flatMap((r) =>
        (r.day.stops ?? []).map((s) => ({
          date: r.date,
          fromMs: s.fromMs,
          lat: s.anchor.lat,
          lon: s.anchor.lon,
          selected: pick?.kind === "stop" && pick.date === r.date && pick.fromMs === s.fromMs,
          stay: s.stayRef?.status ?? null,
        }))
      ),
    [loaded, pick]
  );
  const onLeg = useCallback(
    (leg: MapLegLine) => setPick({ kind: "leg", date: leg.date, id: leg.id }),
    []
  );
  const onStop = useCallback(
    (stop: MapStop) => setPick({ kind: "stop", date: stop.date, fromMs: stop.fromMs }),
    []
  );
  const entryHref =
    resolved?.kind === "leg" && resolved.leg.entryRef
      ? (resolved.day.context.find((c) => c.id === resolved.leg.entryRef?.id)?.href ?? null)
      : null;

  const photoWindow = useMemo(
    () =>
      prefs.layers.photos
        ? short
          ? photoWindowOf(source.segments)
          : ({ kind: "tooLong" } as const)
        : null,
    [prefs.layers.photos, short, source.segments]
  );
  const photos = useTrackPhotos(
    !loading && photoWindow?.kind === "window" ? photoWindow.window : null,
    generation
  );
  const photoList = photos.kind === "loaded" ? photos.photos : [];
  const countries = useVisitedCountries(prefs.layers.countries ? span : null, generation);
  const countryShapes = countries.kind === "loaded" ? countries.shapes : NO_SHAPES;

  const onPoint = useCallback((p: MapPoint) => setSelected(p), []);
  const onPhoto = useCallback((p: TravTrackPhoto) => setPhoto(p), []);
  const follow = liveState.kind === "following" ? liveState.at : null;
  const failed = long ? data.range?.kind === "failed" : dayResults.some((r) => r.kind === "failed");
  const empty = !loading && !failed && totals.points === 0;
  const hasDrawing = source.segments.some((s) => s.length > 0);
  const reload = () => setGeneration((g) => g + 1);
  const flightTrack = useFlightTrack(flight ? seriesWindow(flightPanel) : null, generation);
  const highlight = flightTrack.kind === "loaded" ? flightTrack.lines : NO_LINES;
  const legFramed = resolved?.kind === "leg" ? legFrame(resolved.day, resolved.leg) : null;
  const framed = legFramed ?? (highlight.length > 0 ? highlight : frameLines);
  const fitPadding = useMemo(() => legFitPadding(phone), [phone]);
  const refit = legFramed
    ? `leg:${resolved?.kind === "leg" ? resolved.leg.id : ""}`
    : highlight.length > 0
      ? `flight:${flight?.id ?? ""}`
      : "day";

  return (
    <div className="flex flex-col gap-4">
      <TrackRangeBar
        span={span}
        today={today}
        live={following}
        onStep={(direction) => go(stepSpan(span, direction, today))}
        onPreset={(preset) => go(presetSpan(preset, today, span))}
        onSpan={go}
        onLive={() => {
          if (following) return setLive(false);
          setLive(true);
          if (long || !days.includes(today)) go({ kind: "day", fromDay: today, toDay: today });
        }}
        onExport={() => setDialog("export")}
        onDelete={() => setDialog("delete")}
      />

      {notice && (
        <p className="t-body" role="status" style={{ color: token("good") }}>
          {notice}
        </p>
      )}
      {liveState.kind === "failed" && (
        <p className="t-body" role="alert" style={{ color: token("bad") }}>
          {t("track:map.live.failed", { reason: t(liveState.key) })}
        </p>
      )}
      <TrackMapNotices
        long={long}
        dayResults={dayResults}
        range={data.range}
        onRetry={reload}
        onResume={data.resume}
      />
      {loading && !long && <p className="t-caption">{t("track:day.loading")}</p>}

      <div className="flex flex-wrap gap-4">
        {!phone && (
          <TrackLayersPanel
            prefs={prefs}
            onChange={setPrefs}
            long={long}
            speedStops={speedStops}
            saveFailed={prefsSaveFailed}
          />
        )}

        <section className="flex min-w-0 flex-col gap-3" style={{ flex: "999 1 480px" }}>
          {empty && (
            <p className="t-body" data-testid="track-day-empty" style={panelStyle}>
              {t(span.kind === "day" ? "track:day.empty" : "track:map.rangeEmpty")}
            </p>
          )}
          {(hasDrawing || highlight.length > 0) && (long || !loading) && (
            <div className="relative">
              <WebGLGuard>
                <TrackRangeMap
                  key={`${span.fromDay}|${span.toDay}|${loading ? "partial" : "whole"}`}
                  refit={refit}
                  fitPadding={legFramed ? fitPadding : undefined}
                  layers={prefs.layers}
                  color={prefs.color}
                  opacity={prefs.opacity}
                  frameLines={framed}
                  highlight={highlight}
                  selection={selectedLines}
                  legLines={replaying ? NO_LEG_LINES : legLineList}
                  onLeg={onLeg}
                  stops={stopList}
                  onStop={onStop}
                  lines={lines}
                  segments={drawn}
                  points={visiblePoints}
                  speedStops={speedStops}
                  legPoints={legPoints}
                  anchors={anchors}
                  replay={head}
                  onPoint={onPoint}
                  photos={photoList}
                  onPhoto={onPhoto}
                  countries={countryShapes}
                  follow={follow}
                  onFogStatus={setFog}
                />
              </WebGLGuard>
              {selected && (
                <TrackPointInspector
                  point={selected}
                  onClose={() => setSelected(null)}
                  onDeleted={() => {
                    setSelected(null);
                    setNotice(t("track:map.point.deleted"));
                    reload();
                  }}
                />
              )}
              {resolved && (
                <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 2 }}>
                  {resolved.kind === "leg" ? (
                    <TrackLegCard
                      leg={resolved.leg}
                      zone={resolved.day.zone}
                      entryHref={entryHref}
                      onClose={() => setPick(null)}
                      onChanged={() => data.refresh(resolved.day.date)}
                      onReplay={
                        legReplayable
                          ? () =>
                              setReplayWindow({
                                fromMs: resolved.leg.fromMs,
                                untilMs: resolved.leg.untilMs,
                              })
                          : null
                      }
                      pointsShown={legKey === pointsOf}
                      onTogglePoints={() => setPointsOf(legKey === pointsOf ? null : legKey)}
                    />
                  ) : (
                    <TrackStopCard
                      key={`${resolved.day.date}-${resolved.stop.fromMs}`}
                      stop={resolved.stop}
                      zone={resolved.day.zone}
                      onClose={() => setPick(null)}
                      onChanged={() => data.refresh(resolved.day.date)}
                    />
                  )}
                </div>
              )}
              {photo && photos.kind === "loaded" && (
                <div
                  role="dialog"
                  aria-label={t("track:photos.title")}
                  data-testid="track-photo-popup"
                  className="flex flex-col gap-2"
                  style={{ ...panelStyle, position: "absolute", right: 12, top: 12, zIndex: 2 }}
                >
                  <TrackPhotoThumb photo={photo} window={photos.window} zone={zone} size={160} />
                  <button type="button" className="underline" onClick={() => setPhoto(null)}>
                    {t("track:map.point.close")}
                  </button>
                </div>
              )}
            </div>
          )}
          {!loading && totals.points > 0 && short && (
            <TrackReplayBar
              replay={{ ...replay, reset: resetReplay }}
              zone={zone}
              multiDay={span.kind !== "day"}
            />
          )}
          {!short && totals.points > 0 && (
            <p className="t-caption" data-testid="track-replay-limit">
              {t("track:map.replay.limit", { days: REPLAY_MAX_DAYS })}
            </p>
          )}
          {prefs.layers.photos && photoWindow?.kind === "tooLong" && (
            <p className="t-caption" data-testid="track-photos-too-long">
              {t("track:photos.needsShorter")}
            </p>
          )}
          {prefs.layers.photos && <TrackPhotoNotice state={photos} />}
          {prefs.layers.countries && <TrackCountriesNotice state={countries} />}
          {fog.kind === "failed" && (
            <p className="t-caption" role="status" style={{ color: token("warn") }}>
              {t(fog.key)}
            </p>
          )}
          {fog.kind === "loading" && <p className="t-caption">{t("track:map.fogLoading")}</p>}
          {totals.points > 0 && (
            <p className="t-caption" data-testid="track-day-count">
              {t("track:day.points", { count: totals.points })}
            </p>
          )}
          {flight && (
            <TrackFlightPanel
              flight={flight}
              zone={zone}
              cursor={replay.t}
              generation={generation}
              onClose={() => setFlight(null)}
              onPanel={setFlightPanel}
            />
          )}
          {flight && flightTrack.kind === "failed" && (
            <p className="t-caption" role="status" style={{ color: token("warn") }}>
              {t("track:flight.mapFailed", { reason: t(flightTrack.key) })}
            </p>
          )}
          {flight && flightTrack.kind === "loaded" && flightTrack.partial && (
            <p className="t-caption" role="status">
              {t("track:flight.mapPartial")}
            </p>
          )}
        </section>

        {/* On a phone the map comes straight after the range control and the
            layer and route settings fold away under it (audit 2026-10-26,
            F-005: at 390 px the map started at y≈1281, below this panel). */}
        {phone && (
          <details className="w-full" data-testid="track-layers-fold">
            <summary
              className="t-card-title flex cursor-pointer items-center"
              style={{ ...panelStyle, minHeight: 44, padding: "8px 16px" }}
            >
              {t("track:map.panel")}
              <span aria-hidden className="ml-auto">
                ▾
              </span>
            </summary>
            <div className="mt-3">
              <TrackLayersPanel
                prefs={prefs}
                onChange={setPrefs}
                long={long}
                speedStops={speedStops}
                fill
                saveFailed={prefsSaveFailed}
              />
            </div>
          </details>
        )}

        <TrackMapAside
          span={span}
          totals={totals}
          loaded={loaded}
          long={long}
          flightId={flight?.id ?? null}
          onFlight={setFlight}
          selection={activePick}
          onSelect={setPick}
        />
      </div>

      <TrackExportDialog
        open={dialog === "export"}
        onClose={() => setDialog(null)}
        fromDay={span.fromDay}
        toDay={span.toDay}
      />
      <TrackDeleteDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        fromDay={span.fromDay}
        toDay={span.toDay}
        onDeleted={(count) => {
          setNotice(t("track:delete.done", { count }));
          setSelected(null);
          reload();
        }}
      />
    </div>
  );
}
