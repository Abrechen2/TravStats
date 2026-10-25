import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import { useTodayZone } from "../../../hooks/useTodayZone";
import type { TravTrackDay } from "../../../lib/api/travtrack";
import { formatDayLong } from "../../../shared/time/calendar";
import { todayIn } from "../../../shared/time/clock";
import TrackCoverageBar from "../TrackCoverageBar";
import TrackDeleteDialog from "../TrackDeleteDialog";
import TrackExportDialog from "../TrackExportDialog";
import TrackTimeline from "../TrackTimeline";
import type { FogStatus } from "./TrackFogLayer";
import TrackLayersPanel from "./TrackLayersPanel";
import TrackPointInspector from "./TrackPointInspector";
import TrackRangeBar from "./TrackRangeBar";
import TrackRangeMap from "./TrackRangeMap";
import TrackReplayBar from "./TrackReplayBar";
import TrackTotalsPanel from "./TrackTotalsPanel";
import { lonLat, rangeTotals, splitAfterPause, type LonLat } from "./trackGeometry";
import { mapAnchors, type MapPoint } from "./trackMapLayers";
import { useTrackMapPrefs } from "./trackMapPrefs";
import { panelStyle } from "./trackMapStyle";
import {
  presetRange,
  rangeDays,
  rangePath,
  stepRange,
  type DayResult,
  type TrackRange,
} from "./trackRange";
import { clipSegments, replayPositions } from "./trackReplay";
import { useLiveFollow } from "./useLiveFollow";
import { useRangeDays } from "./useRangeDays";
import { useReplay } from "./useReplay";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Loaded = Extract<DayResult, { kind: "loaded" }>;
type Failed = Extract<DayResult, { kind: "failed" }>;

const toLines = (segments: TravTrackDay["segments"]): LonLat[][] =>
  segments.filter((s) => s.length > 1).map((s) => s.map(lonLat));

/**
 * The „Karte" tab of `/track` (TravTrack plan T5.2, board „Track-Karte"): a
 * range bar, the layers and route panel, the map with its replay, and the
 * span's totals beside the coverage and the logbook's timeline. Everything is
 * drawn from the day reads' safe stretches; a day that failed to load says so
 * by name and is never drawn as an empty day. Private zones are not drawn.
 */
export default function TrackMapView(): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const navigate = useNavigate();
  const params = useParams<{ date?: string }>();
  const [search] = useSearchParams();
  const profileZone = useTodayZone();
  const today = todayIn(profileZone);
  const end = params.date && DAY.test(params.date) ? params.date : today;
  const length = search.get("range") === "7" ? 7 : 1;
  const range = useMemo<TrackRange>(() => ({ end, length }), [end, length]);
  const days = useMemo(() => rangeDays(range), [range]);
  const [generation, setGeneration] = useState(0);
  const { results, refresh } = useRangeDays(days, generation);
  const [prefs, setPrefs] = useTrackMapPrefs();
  const [dialog, setDialog] = useState<"export" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [fog, setFog] = useState<FogStatus>({ kind: "idle" });
  const [live, setLive] = useState(false);
  const following = live && days.includes(today);
  const liveState = useLiveFollow(following, () => refresh(today));

  const go = (next: TrackRange) => {
    setNotice(null);
    setSelected(null);
    navigate(rangePath(next, today));
  };

  useEffect(() => {
    if (!prefs.layers.fog) setFog({ kind: "idle" });
  }, [prefs.layers.fog]);

  const loaded = useMemo(() => results.filter((r): r is Loaded => r.kind === "loaded"), [results]);
  const failed = results.filter((r): r is Failed => r.kind === "failed");
  const loading = results.some((r) => r.kind === "loading");
  const zone = loaded[0]?.day.zone ?? profileZone;

  const shown = useMemo(
    () =>
      splitAfterPause(
        loaded.flatMap((r) => r.day.segments),
        prefs.splitMinutes === null ? null : prefs.splitMinutes * 60_000
      ),
    [loaded, prefs.splitMinutes]
  );
  const replay = useReplay(shown);
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
      loaded.flatMap((r) => r.day.segments.flat().map((point) => ({ point, zone: r.day.zone }))),
    [loaded]
  );
  const anchors = useMemo(() => loaded.flatMap((r) => mapAnchors(r.day.context, t)), [loaded, t]);
  const totals = useMemo(
    () =>
      rangeTotals(
        shown,
        loaded.map((r) => r.day)
      ),
    [shown, loaded]
  );
  // In a week, a day with nothing recorded and nothing known is one name in a line, not a card.
  const isQuiet = (r: Loaded) => r.day.pointCount === 0 && r.day.context.length === 0;
  const quiet = loaded.filter(isQuiet);
  const busy = loaded.filter((r) => !isQuiet(r));
  const onPoint = useCallback((p: MapPoint) => setSelected(p), []);
  const follow = liveState.kind === "following" ? liveState.at : null;
  const empty = !loading && failed.length === 0 && totals.points === 0;

  return (
    <div className="flex flex-col gap-4">
      <TrackRangeBar
        range={range}
        today={today}
        live={following}
        onRange={(direction) => go(stepRange(range, direction))}
        onPreset={(preset) => go(presetRange(preset, today, range))}
        onPick={(day) => go({ end: day, length: 1 })}
        onLive={() => {
          if (following) return setLive(false);
          setLive(true);
          if (!days.includes(today)) go({ end: today, length: 1 });
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
      {failed.length > 0 && (
        <div role="alert" className="flex flex-col gap-1" data-testid="track-failed-days">
          {failed.map((f) => (
            <p key={f.date} className="t-body" style={{ color: token("bad") }}>
              {t("track:map.dayFailed", {
                day: formatDayLong(f.date, i18n.language),
                reason: t(f.key),
              })}
            </p>
          ))}
          <button
            type="button"
            className="self-start underline"
            onClick={() => setGeneration((g) => g + 1)}
          >
            {t("track:map.retry")}
          </button>
        </div>
      )}
      {loading && <p className="t-caption">{t("track:day.loading")}</p>}

      <div className="flex flex-wrap gap-4">
        <TrackLayersPanel prefs={prefs} onChange={setPrefs} />

        <section className="flex min-w-0 flex-col gap-3" style={{ flex: "999 1 480px" }}>
          {empty && (
            <p className="t-body" data-testid="track-day-empty" style={panelStyle}>
              {t(length === 1 ? "track:day.empty" : "track:map.rangeEmpty")}
            </p>
          )}
          {!loading && totals.points > 0 && (
            <div className="relative">
              <TrackRangeMap
                key={days.join(",")}
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
                follow={follow}
                onFogStatus={setFog}
              />
              {selected && (
                <TrackPointInspector point={selected} onClose={() => setSelected(null)} />
              )}
            </div>
          )}
          {!loading && totals.points > 0 && (
            <TrackReplayBar replay={replay} zone={zone} multiDay={length > 1} />
          )}
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
          {loaded
            .filter((r) => r.day.truncated)
            .map((r) => (
              <p key={r.date} className="t-caption" role="status" style={{ color: token("warn") }}>
                {length > 1 ? `${formatDayLong(r.date, i18n.language)}: ` : ""}
                {t("track:day.truncated")}
              </p>
            ))}
        </section>

        <aside className="flex flex-col gap-3" style={{ flex: "1 1 280px", maxWidth: 360 }}>
          <TrackTotalsPanel totals={totals} />
          {length > 1 && quiet.length > 0 && (
            <p className="t-caption" style={panelStyle} data-testid="track-quiet-days">
              {t("track:map.quietDays", {
                days: quiet
                  .map((r) =>
                    formatDayLong(r.date, i18n.language, { weekday: "short", day: "numeric" })
                  )
                  .join(", "),
              })}
            </p>
          )}
          {(length > 1 ? busy : loaded).map((r) => (
            <section key={r.date} className="flex flex-col gap-3" style={panelStyle}>
              {length > 1 && (
                <h2 className="t-card-title">{formatDayLong(r.date, i18n.language)}</h2>
              )}
              <TrackCoverageBar coverage={r.day.coverage} zone={r.day.zone} />
              <TrackTimeline day={r.day} />
            </section>
          ))}
        </aside>
      </div>

      <TrackExportDialog
        open={dialog === "export"}
        onClose={() => setDialog(null)}
        fromDay={days[0]}
        toDay={days[days.length - 1]}
      />
      <TrackDeleteDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        fromDay={days[0]}
        toDay={days[days.length - 1]}
        onDeleted={(count) => {
          setNotice(t("track:delete.done", { count }));
          setSelected(null);
          setGeneration((g) => g + 1);
        }}
      />
    </div>
  );
}
