import type { JSX } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Segmented } from "../../components/ui/Segmented";
import { useTranslation } from "../../hooks/useTranslation";
import { useTravTrackAccess } from "../../hooks/useTravTrackVisible";
import { LastSeenLine } from "../../components/Dashboard/LastSeenCard";
import TrackExploredMap from "./TrackExploredMap";
import TrackMonths from "./TrackMonths";
import TrackMapView from "./map/TrackMapView";

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
      <LastSeenLine />
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
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      <TrackHeader view="day" />
      <TrackMapView />
    </div>
  );
}
