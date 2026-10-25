import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import Button from "../../components/ui/Button";
import { Field, Input } from "../../components/ui/Field";
import { Segmented } from "../../components/ui/Segmented";
import { token } from "../../components/ui/tokens";
import { useTranslation } from "../../hooks/useTranslation";
import { useTodayZone } from "../../hooks/useTodayZone";
import { useTravTrackAccess } from "../../hooks/useTravTrackVisible";
import { logger } from "../../lib/logger";
import {
  trackErrorKey,
  travTrackApi,
  type PrivacyZone,
  type TravTrackDay,
} from "../../lib/api/travtrack";
import { addDays } from "../../shared/time/calendar";
import { todayIn } from "../../shared/time/clock";
import TrackCoverageBar from "./TrackCoverageBar";
import TrackDayMap from "./TrackDayMap";
import TrackDeleteDialog from "./TrackDeleteDialog";
import TrackExportDialog from "./TrackExportDialog";
import TrackExploredMap from "./TrackExploredMap";
import TrackMonths from "./TrackMonths";
import TrackTimeline from "./TrackTimeline";
import { dayAnchors } from "./trackContextLabel";

type DayState =
  { kind: "loading" } | { kind: "failed"; key: string } | { kind: "loaded"; day: TravTrackDay };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type TrackView = "day" | "explored" | "months";

/**
 * `/track` and `/track/:date` — one day of the own location history
 * (TravTrack plan T6, prototype board "Track-Tag"): the map, what the phone
 * recorded, what TravStats knows of the day, export and delete. `/track/explored`
 * is the second tab, the explored map (plan L1), `/track/months` the third,
 * the monthly values (plan L3). Offered only where
 * `useTravTrackAccess` says so; a refusal on the way (TravTrack switched off
 * meanwhile) shows its own copy, never an empty map.
 */
export default function TrackPage({ view = "day" }: { view?: TrackView }): JSX.Element | null {
  const access = useTravTrackAccess();
  if (access === "pending") return null;
  if (access === "hidden") return <Navigate to="/dashboard" replace />;
  if (view === "explored") return <TrackTabView view="explored" />;
  if (view === "months") return <TrackTabView view="months" />;
  return <TrackDayView />;
}

function TrackHeader({ view }: { view: TrackView }): JSX.Element {
  const { t } = useTranslation(["track"]);
  const navigate = useNavigate();
  return (
    <header className="flex flex-col gap-2">
      <h1 className="t-screen-title">{t("track:title")}</h1>
      <p className="t-caption">{t("track:intro")}</p>
      <Segmented<TrackView>
        label={t("track:tabs.label")}
        value={view}
        options={[
          { value: "day", label: t("track:tabs.day") },
          { value: "explored", label: t("track:tabs.explored") },
          { value: "months", label: t("track:tabs.months") },
        ]}
        onChange={(next) => navigate(next === "day" ? "/track" : `/track/${next}`)}
      />
    </header>
  );
}

function TrackTabView({ view }: { view: "explored" | "months" }): JSX.Element {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <TrackHeader view={view} />
      {view === "explored" ? <TrackExploredMap /> : <TrackMonths />}
    </div>
  );
}

function TrackDayView(): JSX.Element {
  const { t } = useTranslation(["track"]);
  const navigate = useNavigate();
  const params = useParams<{ date?: string }>();
  const today = todayIn(useTodayZone());
  const date = params.date && DAY.test(params.date) ? params.date : today;
  const [state, setState] = useState<DayState>({ kind: "loading" });
  const [zones, setZones] = useState<PrivacyZone[]>([]);
  const [generation, setGeneration] = useState(0);
  const [dialog, setDialog] = useState<"export" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    travTrackApi
      .day(date)
      .then((day) => {
        if (live) setState({ kind: "loaded", day });
      })
      .catch((err: unknown) => {
        logger.warn("TravTrack day could not be loaded", err);
        if (live) setState({ kind: "failed", key: trackErrorKey(err) });
      });
    return () => {
      live = false;
    };
  }, [date, generation]);

  useEffect(() => {
    let live = true;
    travTrackApi
      .zones()
      .then((list) => {
        if (live) setZones(list);
      })
      .catch((err: unknown) => logger.warn("TravTrack zones could not be loaded", err));
    return () => {
      live = false;
    };
  }, []);

  const go = (day: string) => {
    setNotice(null);
    navigate(`/track/${day}`);
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <TrackHeader view="day" />

      <div className="flex flex-wrap items-end gap-2">
        <Button onClick={() => go(addDays(date, -1))}>{t("track:day.previous")}</Button>
        <Field label={t("track:day.label")} htmlFor="track-day">
          <Input
            id="track-day"
            type="date"
            value={date}
            onChange={(e) => DAY.test(e.target.value) && go(e.target.value)}
          />
        </Field>
        <Button onClick={() => go(addDays(date, 1))}>{t("track:day.next")}</Button>
        {date !== today && <Button onClick={() => go(today)}>{t("track:day.today")}</Button>}
        <span className="flex-1" />
        <Button onClick={() => setDialog("export")}>{t("track:actions.export")}</Button>
        <Button onClick={() => setDialog("delete")}>{t("track:actions.delete")}</Button>
      </div>

      {notice && (
        <p className="t-body" role="status" style={{ color: token("good") }}>
          {notice}
        </p>
      )}

      {state.kind === "loading" && <p className="t-caption">{t("track:day.loading")}</p>}
      {state.kind === "failed" && (
        <p className="t-body" role="alert" style={{ color: token("bad") }}>
          {t(state.key)}
        </p>
      )}
      {state.kind === "loaded" && <DayBody day={state.day} zones={zones} />}

      <TrackExportDialog
        open={dialog === "export"}
        onClose={() => setDialog(null)}
        fromDay={date}
        toDay={date}
      />
      <TrackDeleteDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        fromDay={date}
        toDay={date}
        onDeleted={(count) => {
          setNotice(t("track:delete.done", { count }));
          reload();
        }}
      />
    </div>
  );
}

function DayBody({ day, zones }: { day: TravTrackDay; zones: PrivacyZone[] }): JSX.Element {
  const { t } = useTranslation(["track"]);
  const anchors = useMemo(() => dayAnchors(day.context, t), [day.context, t]);
  return (
    <>
      {day.pointCount === 0 ? (
        <p className="t-body" data-testid="track-day-empty">
          {t("track:day.empty")}
        </p>
      ) : (
        <>
          <TrackDayMap key={day.date} segments={day.segments} zones={zones} anchors={anchors} />
          <p className="t-caption" data-testid="track-day-count">
            {t("track:day.points", { count: day.pointCount })}
          </p>
          {zones.length > 0 && <p className="t-caption">{t("track:zones.legend")}</p>}
        </>
      )}
      {day.truncated && (
        <p className="t-caption" role="status" style={{ color: token("warn") }}>
          {t("track:day.truncated")}
        </p>
      )}
      <TrackCoverageBar coverage={day.coverage} zone={day.zone} />
      <TrackTimeline day={day} />
    </>
  );
}
