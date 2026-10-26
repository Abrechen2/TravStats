import type { JSX } from "react";
import { Navigate } from "react-router-dom";
import NavigationBar from "../../components/NavigationBar";
import { useTranslation } from "../../hooks/useTranslation";
import { useTravTrackState } from "../../hooks/useTravTrackVisible";
import { LastSeenLine } from "../../components/Dashboard/LastSeenCard";
import TrackExploredMap from "./TrackExploredMap";
import TrackGettingStarted from "./TrackGettingStarted";
import TrackImports from "./TrackImports";
import TrackMonths from "./TrackMonths";
import TrackStays from "./TrackStays";
import TrackMapView from "./map/TrackMapView";
import type { TrackTab } from "./trackViews";

export type TrackView = "day" | TrackTab;

const TAB_BODY: Record<TrackTab, () => JSX.Element> = {
  explored: () => <TrackExploredMap />,
  months: () => <TrackMonths />,
  stays: () => <TrackStays />,
  imports: () => <TrackImports />,
};

/**
 * `/track` and `/track/:date` — the own location history on the map (TravTrack
 * plan T6, phase 5 board "Track-Karte"): range, layers, replay, totals,
 * export and delete. The other views — explored map (L1), monthly values (L3),
 * stays and imports (phase 5) — hang off the app header's Track menu. Offered
 * only where `useTravTrackAccess` says so; a refusal on the way (TravTrack
 * switched off meanwhile) shows its own copy, never an empty map.
 */
export default function TrackPage({ view = "day" }: { view?: TrackView }): JSX.Element | null {
  const { access, caps } = useTravTrackState();
  if (access === "pending") return null;
  if (access === "hidden") return <Navigate to="/dashboard" replace />;
  // The app's own header carries Track's menu (phase 5, header variant B);
  // the page draws no tab strip of its own.
  return (
    <>
      <NavigationBar />
      {view === "day" && caps && !caps.hasData ? (
        // Nothing recorded or imported yet: how data comes in, instead of an empty map.
        <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
          <TrackHeader />
          <TrackGettingStarted active={caps.active} />
        </div>
      ) : view === "day" ? (
        <TrackDayView />
      ) : (
        <TrackTabView view={view} />
      )}
    </>
  );
}

function TrackHeader(): JSX.Element {
  const { t } = useTranslation(["track"]);
  return (
    <header className="flex flex-col gap-2">
      <h1 className="t-screen-title">{t("track:title")}</h1>
      <p className="t-caption">{t("track:intro")}</p>
      <LastSeenLine />
    </header>
  );
}

function TrackTabView({ view }: { view: TrackTab }): JSX.Element {
  const Body = TAB_BODY[view];
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <TrackHeader />
      <Body />
    </div>
  );
}

function TrackDayView(): JSX.Element {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      <TrackHeader />
      <TrackMapView />
    </div>
  );
}
