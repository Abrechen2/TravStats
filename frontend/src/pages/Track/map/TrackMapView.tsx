import { useCallback, useEffect, useMemo, useState } from "react";
import { collapseFolded, type FoldedSpan } from "./collapseFolded";
import type { JSX } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useTodayZone } from "../../../hooks/useTodayZone";
import type { Feature, Geometry } from "geojson";
import type { TrackPoint } from "../../../lib/api/travtrack";
import type { TravTrackFlightPanel, TravTrackPhoto } from "../../../lib/api/travtrackViews";
import { todayIn } from "../../../shared/time/clock";
import TrackCoverageBar from "../TrackCoverageBar";
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
import TrackFloatingCard, { floatingStyle } from "./TrackFloatingCard";
import TrackLayersPanel from "./TrackLayersPanel";
import TrackMapAside from "./TrackMapAside";
import TrackMapNotices from "./TrackMapNotices";
import TrackPointInspector from "./TrackPointInspector";
import TrackRangeBar from "./TrackRangeBar";
import TrackRangeMap from "./TrackRangeMap";
import TrackReplayDock from "./TrackReplayDock";
import TrackTotalsPanel from "./TrackTotalsPanel";
import { lonLat, rangeTotals, splitAfterPause, type LonLat } from "./trackGeometry";
import {
  legFrame,
  legLines,
  legSegments,
  stageFitPadding,
  totalsFromAggregates,
  type TrackSelection,
} from "./trackLegs";
import { mapAnchors, type MapLegLine, type MapPoint, type MapStop } from "./trackMapLayers";
import { useTrackMapPrefs } from "./trackMapPrefs";
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
import { useNarrowStage } from "./useNarrowStage";
import { useReplay } from "./useReplay";
import { useTrackMapData } from "./useTrackMapData";
import WebGLGuard from "../../../components/map/WebGLGuard";

type Loaded = Extract<DayResult, { kind: "loaded" }>;

/** No stretches for the replay of a span longer than it plays. */
const NO_STRETCHES: TrackPoint[][] = [];
const NO_SHAPES: Feature<Geometry>[] = [];
const NO_LINES: LonLat[][] = [];
const NO_SEGMENTS: TrackPoint[][] = [];
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
  const narrow = useNarrowStage();
  const coarse = useCoarsePointer();
  const navigate = useNavigate();
  const params = useParams<{ date?: string }>();
  const [search, setSearch] = useSearchParams();
  const flightParam = search.get("flight");
  const profileZone = useTodayZone();
  const today = todayIn(profileZone);
  const span = useMemo(() => parseSpan(params.date, search, today), [params.date, search, today]);
  const [generation, setGeneration] = useState(0);
  const data = useTrackMapData(span, generation);
  const { long, dayResults, source, loading } = data;
  const [prefs, setPrefs, prefsSaveFailed] = useTrackMapPrefs();
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [pick, setPick] = useState<TrackSelection | null>(null);
  const [photo, setPhoto] = useState<TravTrackPhoto | null>(null);
  // "Play this leg": the replay is limited to this window until it is reset.
  const [replayWindow, setReplayWindow] = useState<ReplaySpan | null>(null);
  // "Show its points": the leg (date + id) whose vertices are drawn as markers.
  const [replayRequest, setReplayRequest] = useState(0);
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
  // Side cards: open on a wide stage, pills on a narrow one; a selection opens the sheet.
  const [layersFolded, setLayersFolded] = useState<boolean | null>(null);
  const [totalsFolded, setTotalsFolded] = useState<boolean | null>(null);
  const [dayFolded, setDayFolded] = useState<boolean | null>(null);
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

  // Back/forward changes the span without `go`: a leg window of another day plays nothing.
  useEffect(() => {
    setReplayWindow(null);
    setPointsOf(null);
  }, [span.fromDay, span.toDay]);

  useEffect(() => {
    if (!prefs.layers.fog) setFog({ kind: "idle" });
  }, [prefs.layers.fog]);

  const loaded = useMemo(
    () => dayResults.filter((r): r is Loaded => r.kind === "loaded"),
    [dayResults]
  );
  const zone = loaded[0]?.day.zone ?? profileZone;

  // A folded stop (fixed place, lodging) is one point on the line; the raw fixes stay for the Points layer.
  const foldedSpans = useMemo<FoldedSpan[]>(
    () =>
      loaded.flatMap((r) =>
        (r.day.stops ?? [])
          .filter((s) => s.folded)
          .map((s) => ({
            fromMs: s.fromMs,
            untilMs: s.untilMs,
            lat: s.anchor.lat,
            lon: s.anchor.lon,
          }))
      ),
    [loaded]
  );
  const collapsed = useMemo(
    () => collapseFolded(source.segments, foldedSpans),
    [source.segments, foldedSpans]
  );
  const shown = useMemo(
    () =>
      splitAfterPause(collapsed, prefs.splitMinutes === null ? null : prefs.splitMinutes * 60_000),
    [collapsed, prefs.splitMinutes]
  );
  const replayed = useMemo(
    () => (replayWindow ? cutToWindow(shown, replayWindow) : shown),
    [shown, replayWindow]
  );
  const replay = useReplay(short ? replayed : NO_STRETCHES, replayRequest);
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
  const selectedSegments = useMemo(
    () =>
      resolved?.kind === "leg" && !replaying
        ? legSegments(resolved.day, resolved.leg)
        : NO_SEGMENTS,
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
        (r.day.stops ?? [])
          .filter((s) => !s.dismissed)
          .map((s) => ({
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
  // Choosing a leg or stop takes the detail slot from an open point or photo.
  const choose = useCallback((next: TrackSelection | null) => {
    if (next) {
      setSelected(null);
      setPhoto(null);
    }
    setPick(next);
  }, []);
  const onLeg = useCallback(
    (leg: MapLegLine) => choose({ kind: "leg", date: leg.date, id: leg.id }),
    [choose]
  );
  const onStop = useCallback(
    (stop: MapStop) => choose({ kind: "stop", date: stop.date, fromMs: stop.fromMs }),
    [choose]
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
  const failed = long ? data.range?.kind === "failed" : dayResults.some((r) => r.kind === "failed");
  const empty = !loading && !failed && totals.points === 0;
  const hasDrawing = source.segments.some((s) => s.length > 0);
  const reload = () => setGeneration((g) => g + 1);
  const flightTrack = useFlightTrack(flight ? seriesWindow(flightPanel) : null, generation);
  const highlight = flightTrack.kind === "loaded" ? flightTrack.lines : NO_LINES;
  const legFramed = resolved?.kind === "leg" ? legFrame(resolved.day, resolved.leg) : null;
  const framed = legFramed ?? (highlight.length > 0 ? highlight : frameLines);
  const detail = selected
    ? "point"
    : photo && photos.kind === "loaded"
      ? "photo"
      : resolved
        ? "pick"
        : flight
          ? "flight"
          : null;
  // Something new selected opens the day card again, even if the reader folded it.
  const detailKey = `${detail ?? ""}|${selected?.point[0] ?? ""}|${photo?.assetId ?? ""}|${legKey ?? ""}|${resolved?.kind === "stop" ? resolved.stop.fromMs : ""}`;
  useEffect(() => setDayFolded(null), [detailKey]);
  const fitPadding = useMemo(() => stageFitPadding(narrow, detail !== null), [narrow, detail]);
  const refit = legFramed
    ? `leg:${resolved?.kind === "leg" ? resolved.leg.id : ""}`
    : highlight.length > 0
      ? `flight:${flight?.id ?? ""}`
      : "day";
  const stopCount = long
    ? null
    : loaded.reduce((n, r) => n + (r.day.stops ?? []).filter((s) => !s.dismissed).length, 0);
  const closeLeg = () => {
    setPick(null);
    // "Ganzer Tag" also ends a "play this leg" window.
    if (replayWindow) resetReplay();
  };

  const detailView =
    detail === "point" && selected ? (
      <TrackPointInspector
        point={selected}
        onClose={() => setSelected(null)}
        onDeleted={() => {
          setSelected(null);
          setNotice(t("track:map.point.deleted"));
          reload();
        }}
      />
    ) : detail === "photo" && photo && photos.kind === "loaded" ? (
      <div
        role="dialog"
        aria-label={t("track:photos.title")}
        data-testid="track-photo-popup"
        className="flex flex-col gap-2"
      >
        <TrackPhotoThumb photo={photo} window={photos.window} zone={zone} size={160} />
        <button type="button" className="self-start underline" onClick={() => setPhoto(null)}>
          {t("track:map.point.close")}
        </button>
      </div>
    ) : resolved?.kind === "leg" ? (
      <TrackLegCard
        leg={resolved.leg}
        zone={resolved.day.zone}
        entryHref={entryHref}
        onClose={closeLeg}
        onChanged={() => data.refresh(resolved.day.date)}
        onReplay={
          legReplayable
            ? () => {
                setReplayWindow({ fromMs: resolved.leg.fromMs, untilMs: resolved.leg.untilMs });
                setReplayRequest((n) => n + 1);
              }
            : null
        }
        pointsShown={legKey === pointsOf}
        onTogglePoints={() => setPointsOf(legKey === pointsOf ? null : legKey)}
      />
    ) : resolved?.kind === "stop" ? (
      <TrackStopCard
        key={`${resolved.day.date}-${resolved.stop.fromMs}`}
        stop={resolved.stop}
        zone={resolved.day.zone}
        onClose={() => setPick(null)}
        onChanged={() => data.refresh(resolved.day.date)}
      />
    ) : flight ? (
      <>
        <TrackFlightPanel
          flight={flight}
          zone={zone}
          cursor={replay.t}
          generation={generation}
          onClose={() => setFlight(null)}
          onPanel={setFlightPanel}
        />
        {flightTrack.kind === "failed" && (
          <p className="t-caption" role="status" style={{ color: token("warn") }}>
            {t("track:flight.mapFailed", { reason: t(flightTrack.key) })}
          </p>
        )}
        {flightTrack.kind === "loaded" && flightTrack.partial && (
          <p className="t-caption" role="status">
            {t("track:flight.mapPartial")}
          </p>
        )}
      </>
    ) : null;

  const layersPanel = (
    <TrackFloatingCard
      testId="track-layers-card"
      title={t("track:map.layers.title")}
      collapsed={layersFolded ?? narrow}
      onToggle={() => setLayersFolded(!(layersFolded ?? narrow))}
      coarse={coarse}
      style={{ flexShrink: 1 }}
    >
      <TrackLayersPanel
        prefs={prefs}
        onChange={setPrefs}
        long={long}
        speedStops={speedStops}
        embedded
        saveFailed={prefsSaveFailed}
      />
    </TrackFloatingCard>
  );
  const dayCard = (
    <TrackMapAside
      span={span}
      loaded={loaded}
      long={long}
      flightId={flight?.id ?? null}
      onFlight={setFlight}
      selection={activePick}
      onSelect={choose}
      onStopPlaceChanged={(date) => void data.refresh(date)}
      detail={detailView}
      collapsed={dayFolded ?? (narrow && detail === null)}
      onToggle={() => setDayFolded(!(dayFolded ?? (narrow && detail === null)))}
    />
  );
  const replayDock =
    !loading && totals.points > 0 && short ? (
      <TrackReplayDock
        replay={{ ...replay, reset: resetReplay }}
        zone={zone}
        multiDay={span.kind !== "day"}
      />
    ) : null;
  const strip =
    span.kind === "day" && loaded[0] ? (
      <TrackCoverageBar
        coverage={loaded[0].day.coverage}
        zone={loaded[0].day.zone}
        context={loaded[0].day.context}
      />
    ) : null;

  return (
    <div
      className="flex flex-col"
      style={{ height: "calc(100dvh - var(--ts-size-web-header))", minHeight: 520 }}
    >
      <TrackRangeBar
        span={span}
        today={today}
        strip={strip}
        onStep={(direction) => go(stepSpan(span, direction, today))}
        onPreset={(preset) => go(presetSpan(preset, today, span))}
        onSpan={go}
      />

      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ background: "var(--ts-surface2)" }}
        data-testid="track-stage"
      >
        {(hasDrawing || highlight.length > 0) && (long || !loading) && (
          <WebGLGuard>
            <TrackRangeMap
              key={`${span.fromDay}|${span.toDay}|${loading ? "partial" : "whole"}`}
              refit={refit}
              fitPadding={fitPadding}
              layers={prefs.layers}
              color={prefs.color}
              opacity={prefs.opacity}
              frameLines={framed}
              highlight={highlight}
              selection={selectedLines}
              selectionSegments={selectedSegments}
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
              follow={null}
              onFogStatus={setFog}
            />
          </WebGLGuard>
        )}

        {/* Notices are compact overlays: the stack disappears when nothing is to say. */}
        <div
          className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 flex-col gap-2 empty:hidden"
          style={{ width: "min(560px, calc(100% - 24px))" }}
          data-testid="track-notices"
        >
          <div
            className="pointer-events-auto flex flex-col gap-1 empty:hidden"
            style={{ ...floatingStyle, padding: 10 }}
          >
            {notice && (
              <p className="t-body" role="status" style={{ color: token("good") }}>
                {notice}
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
            {empty && (
              <p className="t-body" data-testid="track-day-empty">
                {t(span.kind === "day" ? "track:day.empty" : "track:map.rangeEmpty")}
              </p>
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
          </div>
        </div>

        {/* Left: layers, then the day in numbers. */}
        <div
          className="pointer-events-none absolute left-3 top-3 z-[5] flex flex-col"
          style={{ width: narrow ? 240 : 300, maxHeight: "calc(100% - 48px)" }}
        >
          <div className="pointer-events-auto flex min-h-0 flex-col gap-3">
            {layersPanel}
            <TrackTotalsPanel
              totals={totals}
              stops={stopCount}
              multi={span.kind !== "day"}
              collapsed={totalsFolded ?? narrow}
              onToggle={() => setTotalsFolded(!(totalsFolded ?? narrow))}
            />
            {totals.points > 0 && (
              <p className="t-caption" data-testid="track-day-count" style={{ paddingLeft: 4 }}>
                {t("track:day.points", { count: totals.points })}
              </p>
            )}
          </div>
        </div>

        {narrow ? (
          <div className="pointer-events-none absolute inset-x-3 bottom-8 z-[5] flex flex-col items-center gap-2">
            <div className="pointer-events-auto flex w-full justify-center">{replayDock}</div>
            <div
              className="pointer-events-auto flex w-full flex-col"
              style={{ maxHeight: "min(52dvh, 420px)" }}
              data-testid="track-sheet"
            >
              {dayCard}
            </div>
          </div>
        ) : (
          <>
            <div
              className="pointer-events-auto absolute right-3 top-3 z-[5] flex flex-col"
              style={{ width: 380, maxHeight: "calc(100% - 48px)" }}
            >
              {dayCard}
            </div>
            {replayDock && (
              <div
                className="pointer-events-auto absolute bottom-6 left-1/2 z-[5] flex -translate-x-1/2 justify-center"
                style={{ width: "min(720px, max(480px, calc(100% - 760px)))" }}
              >
                {replayDock}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
