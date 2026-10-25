import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import { useTodayZone } from "../../../hooks/useTodayZone";
import type { TrackPoint } from "../../../lib/api/travtrack";
import type { TravTrackPhoto } from "../../../lib/api/travtrackViews";
import { todayIn } from "../../../shared/time/clock";
import TrackDeleteDialog from "../TrackDeleteDialog";
import TrackExportDialog from "../TrackExportDialog";
import TrackFlightPanel, { type SelectedFlight } from "../flight/TrackFlightPanel";
import TrackPhotoNotice from "../photos/TrackPhotoNotice";
import TrackPhotoThumb from "../photos/TrackPhotoThumb";
import { photoWindowOf } from "../photos/trackPhotos";
import { useTrackPhotos } from "../photos/useTrackPhotos";
import type { FogStatus } from "./TrackFogLayer";
import TrackLayersPanel from "./TrackLayersPanel";
import TrackMapAside from "./TrackMapAside";
import TrackMapNotices from "./TrackMapNotices";
import TrackPointInspector from "./TrackPointInspector";
import TrackRangeBar from "./TrackRangeBar";
import TrackRangeMap from "./TrackRangeMap";
import TrackReplayBar from "./TrackReplayBar";
import { lonLat, rangeTotals, splitAfterPause, type LonLat } from "./trackGeometry";
import { mapAnchors, type MapPoint } from "./trackMapLayers";
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
import { clipSegments, replayPositions } from "./trackReplay";
import { useLiveFollow } from "./useLiveFollow";
import { useReplay } from "./useReplay";
import { useTrackMapData } from "./useTrackMapData";

type Loaded = Extract<DayResult, { kind: "loaded" }>;

/** No stretches for the replay of a span longer than it plays. */
const NO_STRETCHES: TrackPoint[][] = [];

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
  const navigate = useNavigate();
  const params = useParams<{ date?: string }>();
  const [search] = useSearchParams();
  const profileZone = useTodayZone();
  const today = todayIn(profileZone);
  const span = useMemo(() => parseSpan(params.date, search, today), [params.date, search, today]);
  const [generation, setGeneration] = useState(0);
  const data = useTrackMapData(span, generation);
  const { long, days, dayResults, source, loading } = data;
  const [prefs, setPrefs] = useTrackMapPrefs();
  const [dialog, setDialog] = useState<"export" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [photo, setPhoto] = useState<TravTrackPhoto | null>(null);
  const [flight, setFlight] = useState<SelectedFlight | null>(null);
  const [fog, setFog] = useState<FogStatus>({ kind: "idle" });
  const [live, setLive] = useState(false);
  const following = live && !long && days.includes(today);
  const liveState = useLiveFollow(following, () => data.refresh(today));
  const short = spanDays(span) <= REPLAY_MAX_DAYS;

  const go = (next: TrackSpan) => {
    setNotice(null);
    setSelected(null);
    setPhoto(null);
    setFlight(null);
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
  const replay = useReplay(short ? shown : NO_STRETCHES);
  const drawn = useMemo(
    () => (replay.t === null ? shown : clipSegments(shown, replay.t)),
    [shown, replay.t]
  );
  const frameLines = useMemo(() => toLines(shown), [shown]);
  const lines = useMemo(() => toLines(drawn), [drawn]);
  const head = useMemo(
    () => (replay.t === null ? [] : replayPositions(shown, replay.t)),
    [shown, replay.t]
  );
  const points = useMemo<MapPoint[]>(
    () =>
      source.segments.flatMap((segment, i) =>
        segment.map((point, j) => ({ point, zone, id: source.ids[i]?.[j] ?? null }))
      ),
    [source, zone]
  );
  const anchors = useMemo(() => loaded.flatMap((r) => mapAnchors(r.day.context, t)), [loaded, t]);
  const totals = useMemo(
    () => rangeTotals(shown, [{ pointCount: source.positions, coverage: source.coverage }]),
    [shown, source]
  );

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

  const onPoint = useCallback((p: MapPoint) => setSelected(p), []);
  const onPhoto = useCallback((p: TravTrackPhoto) => setPhoto(p), []);
  const follow = liveState.kind === "following" ? liveState.at : null;
  const failed = long ? data.range?.kind === "failed" : dayResults.some((r) => r.kind === "failed");
  const empty = !loading && !failed && totals.points === 0;
  const hasDrawing = source.segments.some((s) => s.length > 0);
  const reload = () => setGeneration((g) => g + 1);

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
        <TrackLayersPanel prefs={prefs} onChange={setPrefs} long={long} />

        <section className="flex min-w-0 flex-col gap-3" style={{ flex: "999 1 480px" }}>
          {empty && (
            <p className="t-body" data-testid="track-day-empty" style={panelStyle}>
              {t(span.kind === "day" ? "track:day.empty" : "track:map.rangeEmpty")}
            </p>
          )}
          {hasDrawing && (long || !loading) && (
            <div className="relative">
              <TrackRangeMap
                key={`${span.fromDay}|${span.toDay}|${loading ? "partial" : "whole"}`}
                layers={prefs.layers}
                color={prefs.color}
                opacity={prefs.opacity}
                frameLines={frameLines}
                lines={lines}
                segments={drawn}
                points={points}
                anchors={anchors}
                replay={head}
                onPoint={onPoint}
                photos={photoList}
                onPhoto={onPhoto}
                follow={follow}
                onFogStatus={setFog}
              />
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
            <TrackReplayBar replay={replay} zone={zone} multiDay={span.kind !== "day"} />
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
            />
          )}
        </section>

        <TrackMapAside
          span={span}
          totals={totals}
          loaded={loaded}
          long={long}
          flightId={flight?.id ?? null}
          onFlight={setFlight}
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
