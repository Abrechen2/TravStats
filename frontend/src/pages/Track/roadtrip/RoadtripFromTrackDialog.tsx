import { useEffect, useMemo, useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../../components/ui/Button";
import { token } from "../../../components/ui/tokens";
import Dialog from "../../../components/ui/Dialog";
import TripSelectField from "../../../components/FlightForm/fields/TripSelectField";
import { useTranslation } from "../../../hooks/useTranslation";
import { roadtripsApi } from "../../../lib/api/roadtrips";
import { toursApi } from "../../../lib/api/tours";
import { trackErrorKey } from "../../../lib/api/travtrack";
import { travTrackRoadtripApi, type RoadtripSpan } from "../../../lib/api/travtrackRoadtrip";
import { formatLocalDate } from "../../../lib/displayFormat";
import { logger } from "../../../lib/logger";
import { localDay, toLocal } from "../../../shared/time/zone";
import { durationText, makeNumber } from "../map/trackLegFormat";
import RoadtripSketch from "./RoadtripSketch";
import {
  draftDistanceKm,
  draftEstimatedKm,
  draftOf,
  dropStation,
  renameStation,
  RoadtripSaveError,
  saveRoadtrip,
  type RoadtripDraft,
} from "./roadtripDraft";

type Load =
  | { phase: "loading" }
  | { phase: "error"; reason: string }
  | { phase: "ready"; draft: RoadtripDraft; zone: string };

const PREVIEW_REASONS = new Set(["tooLong", "noPoints", "truncated", "tooFewStations"]);

function previewFailure(error: unknown): string {
  const reason = (error as { response?: { data?: { reason?: unknown } } } | null)?.response?.data
    ?.reason;
  return typeof reason === "string" && PREVIEW_REASONS.has(reason) ? `preview.${reason}` : "";
}

/**
 * "Als Roadtrip übernehmen" (rc46 extras A): the stations a recorded span
 * gives — each with name, time and dwell, renameable, the inner ones
 * droppable — the line with its estimated gaps dashed, the distance, and an
 * optional trip. Saving writes through the roadtrip and tour APIs with the
 * track as the drawn line (`saveRoadtrip`); a failed save says at which step
 * and leaves nothing half-made behind.
 */
export default function RoadtripFromTrackDialog({
  span,
  days,
  onClose,
}: {
  span: RoadtripSpan;
  /** The profile days the span covers, for the back link and the trip preselection. */
  days: { fromDay: string; toDay: string };
  onClose: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const navigate = useNavigate();
  const text = (key: string, values?: Record<string, unknown>) =>
    t(`track:roadtrip.${key}`, values);
  const num = useMemo(() => makeNumber(i18n.language), [i18n.language]);
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  // The day in the account's own date format, as everywhere else — never the ISO key.
  const [name, setName] = useState(() =>
    t("track:roadtrip.defaultName", { day: formatLocalDate(days.fromDay) })
  );
  const [tripId, setTripId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const spanKey = JSON.stringify(span);

  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const preview = await travTrackRoadtripApi.preview(JSON.parse(spanKey) as RoadtripSpan);
        if (!live) return;
        const fallback = (n: number) => t("track:roadtrip.stopName", { n });
        setLoad({ phase: "ready", draft: draftOf(preview, fallback), zone: preview.zone });
      } catch (error) {
        logger.warn("Roadtrip preview failed", error);
        if (!live) return;
        const own = previewFailure(error);
        setLoad({ phase: "error", reason: own ? text(own) : t(trackErrorKey(error)) });
      }
    };
    void read();
    return () => {
      live = false;
    };
    // `t` and `text` are read once per span; a language switch does not re-read the preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spanKey]);

  const ready = load.phase === "ready" ? load : null;
  const emptyName = ready?.draft.stations.some((s) => s.title.trim() === "") ?? false;

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setSaveError(null);
    try {
      const id = await saveRoadtrip(
        ready.draft,
        { name, tripId: tripId || null, trackSpan: days, zone: ready.zone },
        {
          create: (input) => roadtripsApi.create(input),
          replaceStations: (rid, stations) => roadtripsApi.replaceStations(rid, stations),
          setDrawnLeg: (rid, from, to, waypoints, distanceKm) =>
            toursApi.setLeg(undefined, rid, from, to, { source: "drawn", waypoints, distanceKm }),
          remove: (rid) => toursApi.removeStandalone(rid),
        },
        localDay
      );
      navigate(`/roadtrips/${id}`);
    } catch (error) {
      logger.warn("Saving the roadtrip from TravTrack failed", error);
      const step = error instanceof RoadtripSaveError ? error.step : "create";
      const kept = error instanceof RoadtripSaveError && !error.rolledBack;
      setSaveError(text(kept ? `saveFailedKept.${step}` : `saveFailed.${step}`));
      setSaving(false);
    }
  };

  const clock = (ms: number | null) =>
    ms === null || !ready ? "–" : toLocal(ms, ready.zone).local.slice(11, 16);

  return (
    <Dialog
      open
      onClose={onClose}
      title={text("title")}
      busy={saving}
      maxWidth={720}
      dismissLabel={text("cancel")}
      closeLabel={text("close")}
      action={
        <Button
          variant="primary"
          disabled={!ready || saving || emptyName || name.trim() === ""}
          onClick={() => void save()}
          data-testid="roadtrip-save"
        >
          {saving ? text("saving") : text("save")}
        </Button>
      }
    >
      {load.phase === "loading" && (
        <p className="t-caption" role="status">
          {text("loading")}
        </p>
      )}
      {load.phase === "error" && (
        <p role="alert" className="t-body" style={{ color: token("bad") }}>
          {load.reason}
        </p>
      )}
      {ready && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="label">{text("name")}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <TripSelectField value={tripId} onChange={setTripId} preselectForDate={days.fromDay} />
          <RoadtripSketch draft={ready.draft} label={text("sketch")} />
          <p className="t-body" data-testid="roadtrip-distance">
            {text("distance", { km: num(draftDistanceKm(ready.draft), 1) })}
            {draftEstimatedKm(ready.draft) > 0 &&
              ` · ${text("estimated", { km: num(draftEstimatedKm(ready.draft), 1) })}`}
          </p>
          <ol className="flex flex-col gap-2" aria-label={text("stations")}>
            {ready.draft.stations.map((s, i) => {
              const inner = i > 0 && i < ready.draft.stations.length - 1;
              const legIn = i > 0 ? ready.draft.legs[i - 1] : null;
              return (
                <li
                  key={s.key}
                  className="flex flex-wrap items-center gap-2"
                  data-testid="roadtrip-station"
                >
                  {legIn && (
                    <span className="t-caption w-full" data-testid="roadtrip-leg-km">
                      {"↓ "}
                      {text("distance", { km: num(legIn.distanceKm, 1) })}
                      {legIn.estimatedKm > 0 &&
                        ` · ${text("estimated", { km: num(legIn.estimatedKm, 1) })}`}
                    </span>
                  )}
                  <input
                    className="input"
                    aria-label={text("stationName", { n: i + 1 })}
                    value={s.title}
                    onChange={(e) =>
                      setLoad({
                        ...ready,
                        draft: renameStation(ready.draft, s.key, e.target.value),
                      })
                    }
                  />
                  <span className="t-caption">
                    {s.arriveMs !== null && s.departMs !== null
                      ? text("stay", {
                          from: clock(s.arriveMs),
                          until: clock(s.departMs),
                          dwell: durationText(s.dwellMs ?? 0, t),
                        })
                      : text(s.kind === "start" ? "departs" : "arrives", {
                          at: clock(s.departMs ?? s.arriveMs),
                        })}
                    {s.placeId && ` · ${text("linkedPlace")}`}
                  </span>
                  {inner && (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setLoad({ ...ready, draft: dropStation(ready.draft, s.key) })}
                    >
                      {text("drop")}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {emptyName && <p className="t-caption">{text("nameNeeded")}</p>}
          {saveError && (
            <p role="alert" className="t-body" style={{ color: token("bad") }}>
              {saveError}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
