import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import Button from "../components/ui/Button";
import DetailHeader from "../components/ui/DetailHeader";
import EmptyState from "../components/ui/EmptyState";
import Pill from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import ConfirmModal from "../components/Training/ConfirmModal";
import TripMap, { type TripMapContent } from "../components/Trips/TripMap";
import LegDialog from "../components/Roadtrips/LegDialog";
import RoadtripFigures from "../components/Roadtrips/RoadtripFigures";
import RoadtripTourCards from "../components/Roadtrips/RoadtripTourCards";
import { RoadtripRailConversion } from "../components/rail/RoadtripRailConversion";
import StationEditor, { type EditorStart } from "../components/Roadtrips/StationEditor";
import StationTimeline from "../components/Roadtrips/StationTimeline";
import { stationHighlightLayer } from "../components/Roadtrips/stationHighlightLayer";
import type { SaveStatus } from "../components/Roadtrips/useStationAutosave";
import { useTranslation } from "../hooks/useTranslation";
import { useDomainColors } from "../hooks/useDomainColors";
import { roadtripsApi } from "../lib/api/roadtrips";
import { toursApi } from "../lib/api/tours";
import { useDisplayFormat } from "../lib/displayFormat";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { hexToRgb } from "../lib/domainColor";
import { logger } from "../lib/logger";
import { dayNumber, localToday, roadtripPhase, spanDays } from "../lib/roadtrip/roadtripView";
import { useToastStore } from "../store/toastStore";
import type { RoadtripDetail, RoadtripStation } from "../types/roadtrip";
import type { TourGeometry, TourLeg } from "../types/tour";

type LegEdit = {
  leg: TourLeg;
  from: { id: string; title: string };
  to: { id: string; title: string };
};

const STATUS_COLOR: Record<SaveStatus, string> = {
  saved: "var(--ts-good)",
  pending: "var(--ts-muted)",
  saving: "var(--ts-muted)",
  error: "var(--ts-bad)",
  waiting: "var(--ts-warn)",
};

/**
 * One roadtrip (design 2026-09-25, board 2): the head and its figures, the
 * stations by day beside a map that follows the selection, then the day
 * tours. Editing happens on the same page — the stations turn into the
 * editor, the map stays — and saves as it goes.
 *
 * `?station=neu` opens the editor with a new station (from "Neuer
 * Roadtrip"), `?station=heute` with one dated today (from "Heutige Nacht
 * eintragen").
 */
export default function RoadtripDetailPage(): JSX.Element {
  const { id = "" } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const { t } = useTranslation(["roadtrips", "common"]);
  const display = useDisplayFormat();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const roadtripColor = useDomainColors().colorOf("roadtrip");
  const today = useMemo(() => localToday(), []);

  const arrival = params.get("station");
  const [editorStart] = useState<EditorStart>(
    arrival === "heute" ? "today" : arrival === "neu" ? "new" : "plain"
  );
  const [editing, setEditing] = useState(editorStart !== "plain");
  const [detail, setDetail] = useState<RoadtripDetail | null>(null);
  const [geometry, setGeometry] = useState<TourGeometry | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [legEdit, setLegEdit] = useState<LegEdit | null>(null);
  const [save, setSave] = useState<{ status: SaveStatus; flush: () => Promise<void> }>({
    status: "saved",
    flush: async () => {},
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The query parameter has done its job once the editor opened.
  useEffect(() => {
    if (arrival) setParams({}, { replace: true });
  }, [arrival, setParams]);

  const load = useCallback(async (): Promise<void> => {
    setLoadError(false);
    try {
      const [d, g] = await Promise.all([
        roadtripsApi.get(id),
        // The line is decoration beside the stations: a failed geometry call
        // leaves the map without it rather than the page without anything.
        toursApi.geometry(undefined, id).catch((err: unknown) => {
          logger.warn("Roadtrip geometry failed to load", err);
          return null;
        }),
      ]);
      if (!mountedRef.current) return;
      setDetail(d);
      setGeometry(g);
    } catch {
      if (mountedRef.current) setLoadError(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onStatus = useCallback(
    (status: SaveStatus, flush: () => Promise<void>) => setSave({ status, flush }),
    []
  );

  const mapContent = useMemo<TripMapContent>(
    () => ({
      stops: (detail?.stations ?? []).map((s) => ({
        title: s.title,
        lat: s.lat,
        lon: s.lon,
        // A night at a stay is drawn in the stay's colour, everything else in
        // the roadtrip's — the same split the markers make.
        domain: s.state === "stay" ? "hotel" : "roadtrip",
      })),
    }),
    [detail]
  );
  const mapGeometries = useMemo(
    () =>
      geometry && detail
        ? [{ routeId: id, name: detail.roadtrip.name, geometry, rgb: hexToRgb(roadtripColor) }]
        : [],
    [geometry, detail, id, roadtripColor]
  );
  const selected = detail?.stations.find((s) => s.id === selectedId) ?? null;
  const highlight = useMemo(
    () =>
      stationHighlightLayer(
        selected && selected.lat !== null && selected.lon !== null
          ? { lat: selected.lat, lon: selected.lon }
          : null
      ),
    [selected]
  );

  const startTour = async (station: RoadtripStation): Promise<void> => {
    try {
      const tour = await toursApi.createStandalone({
        name: station.title,
        mode: "foot",
        activity: "hike",
      });
      await toursApi.update(undefined, tour.id, { anchorStopId: station.id });
      navigate(`/tours/${tour.id}`);
    } catch {
      addToast("error", t("roadtrips:startTourError"));
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await toursApi.removeStandalone(id);
      navigate("/roadtrips");
    } catch {
      addToast("error", t("roadtrips:deleteError"));
    }
  };

  // A station that is not complete keeps the editor open: closing would
  // leave it unsaved with nothing on screen saying so. Its hint is already
  // in the "still open" list.
  const finishEditing = async (): Promise<void> => {
    if (save.status === "waiting") return;
    await save.flush();
    setEditing(false);
    await load();
  };

  if (loadError) {
    return (
      <AppShell width="table">
        <EmptyState
          kind="degraded"
          title={t("roadtrips:detailLoadError")}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              {t("common:buttons.retry")}
            </Button>
          }
        />
      </AppShell>
    );
  }
  if (!detail) {
    return (
      <AppShell width="table">
        <div
          aria-busy="true"
          aria-label={t("common:loading.default")}
          className="flex flex-col"
          style={{ gap: 16 }}
        >
          <div
            className="animate-pulse"
            style={{
              height: 150,
              borderRadius: "var(--ts-radius-card)",
              background: "var(--ts-surface)",
            }}
          />
          <div
            className="animate-pulse"
            style={{
              height: 96,
              borderRadius: "var(--ts-radius-card)",
              background: "var(--ts-surface)",
            }}
          />
          <div
            className="animate-pulse"
            style={{
              height: 420,
              borderRadius: "var(--ts-radius-card)",
              background: "var(--ts-surface)",
            }}
          />
        </div>
      </AppShell>
    );
  }

  const r = detail.roadtrip;
  const phase = roadtripPhase(detail.startDate, detail.endDate, today);
  const day = dayNumber(detail.startDate, today);
  const total = spanDays(detail.startDate, detail.endDate);
  const span =
    detail.startDate === null
      ? t("roadtrips:undated")
      : `${display.date(detail.startDate, { timeZone: "UTC", omitYear: detail.endDate !== null })}${
          detail.endDate && detail.endDate.slice(0, 10) !== detail.startDate.slice(0, 10)
            ? ` – ${display.date(detail.endDate, { timeZone: "UTC" })}`
            : ""
        }`;

  const status =
    phase === "underway" && day !== null ? (
      <Pill color="var(--ts-good)">
        {total !== null
          ? t("roadtrips:phase.underway", { day, total })
          : t("roadtrips:phase.underwayOpen", { day })}
      </Pill>
    ) : phase === "planned" ? (
      <Pill color="var(--ts-info)">{t("roadtrips:phase.planned")}</Pill>
    ) : undefined;

  const actions = editing ? (
    <div className="flex flex-wrap items-center" style={{ gap: 12 }}>
      <span
        role="status"
        className="flex items-center"
        style={{ gap: 6, fontSize: 13, color: STATUS_COLOR[save.status] }}
      >
        {save.status === "saved" && <Icon name="check" size={14} />}
        {t(`roadtrips:editor.status.${save.status}`)}
        {save.status === "error" && (
          <button type="button" className="underline" onClick={() => void save.flush()}>
            {t("roadtrips:editor.status.retry")}
          </button>
        )}
      </span>
      <Button variant="primary" onClick={() => void finishEditing()}>
        {t("roadtrips:detail.done")}
      </Button>
    </div>
  ) : (
    <div className="flex flex-wrap" style={{ gap: 8 }}>
      <Link
        to={`/tours/${id}`}
        className="flex items-center"
        style={{
          minHeight: "var(--ts-size-touch-min)",
          padding: "0 14px",
          borderRadius: "var(--ts-radius-button)",
          border: "1px solid var(--ts-border-button)",
          color: "var(--ts-text)",
          textDecoration: "none",
          fontSize: 14,
        }}
      >
        {t("roadtrips:editLegs")}
      </Link>
      <Button
        variant="primary"
        icon={<Icon name="pencil" size={16} />}
        onClick={() => setEditing(true)}
      >
        {t("roadtrips:detail.edit")}
      </Button>
    </div>
  );

  return (
    <AppShell width="table">
      <DetailHeader
        backTo="/roadtrips"
        backLabel={t("roadtrips:pageTitle")}
        domain="roadtrip"
        icon={<Icon name="caravan" size={24} />}
        title={r.name}
        status={status}
        subtitle={
          <span>
            {[
              r.vehicle ? t(`roadtrips:vehicle.${r.vehicle}`) : null,
              r.vehicleName ? `„${r.vehicleName}“` : null,
              span,
            ]
              .filter(Boolean)
              .join(" · ")}
            {detail.trip && (
              <>
                {" · "}
                <Link to={`/trips/${detail.trip.id}`}>
                  {t("roadtrips:inTrip", { name: detail.trip.name })}
                </Link>
              </>
            )}
          </span>
        }
        actions={actions}
      />

      <RoadtripFigures detail={detail} today={today} />

      {/* A roadtrip stored by rail, from before rail was a domain (rail beta). */}
      <RoadtripRailConversion routeId={id} vehicle={r.vehicle} onConverted={() => void load()} />

      <div
        className="grid items-start lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]"
        style={{ gap: "var(--ts-space-xl)", marginTop: "var(--ts-space-xl)" }}
      >
        <section className="order-2 flex min-w-0 flex-col lg:order-1" style={{ gap: 8 }}>
          <h2 className="t-card-title">{t("roadtrips:stations.title")}</h2>
          {editing ? (
            <StationEditor
              routeId={id}
              stations={detail.stations.filter((s) => s.lat !== null)}
              legs={detail.legs}
              tripId={detail.trip?.id ?? null}
              start={editorStart}
              today={today}
              onSaved={() => void load()}
              onStatus={onStatus}
              onEditLeg={(leg, from, to) => setLegEdit({ leg, from, to })}
            />
          ) : (
            <StationTimeline
              stations={detail.stations}
              legs={detail.legs}
              tours={detail.tours}
              startDate={detail.startDate}
              today={today}
              selectedId={selectedId}
              onSelect={(s) => setSelectedId((cur) => (cur === s.id ? null : s.id))}
              onStartTour={(s) => void startTour(s)}
            />
          )}
        </section>

        <aside className="order-1 flex flex-col lg:sticky lg:order-2" style={{ gap: 8, top: 72 }}>
          <div
            className="overflow-hidden"
            style={{
              borderRadius: 20,
              border: "1px solid var(--ts-border)",
              height: "min(640px, calc(100vh - 96px))",
              minHeight: 380,
            }}
          >
            <TripMap trip={mapContent} tourGeometries={mapGeometries} extraLayers={highlight} />
          </div>
          {!editing && <span className="t-caption">{t("roadtrips:detail.mapHint")}</span>}
        </aside>
      </div>

      <section className="flex flex-col" style={{ gap: 14, marginTop: "var(--ts-space-xxl)" }}>
        <h2 className="t-card-title">{t("roadtrips:detail.toursTitle")}</h2>
        <RoadtripTourCards tours={detail.tours} stations={detail.stations} />
      </section>

      <footer className="mt-8 pt-4 text-sm" style={{ borderTop: "1px solid var(--ts-border)" }}>
        <button type="button" className="underline" onClick={() => setConfirmDelete(true)}>
          {t("roadtrips:delete")}
        </button>
      </footer>

      {legEdit && (
        <LegDialog
          routeId={id}
          leg={legEdit.leg}
          from={legEdit.from}
          to={legEdit.to}
          routingAvailable={detail.routingAvailable}
          onClose={() => setLegEdit(null)}
          onSaved={() => {
            setLegEdit(null);
            void load();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          isOpen
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void remove();
          }}
          title={t("roadtrips:deleteConfirm.title")}
          message={t("roadtrips:deleteConfirm.message", { name: r.name })}
          confirmText={t("roadtrips:deleteConfirm.confirm")}
          confirmButtonClass={DELETE_BUTTON_CLASS}
        />
      )}
    </AppShell>
  );
}
