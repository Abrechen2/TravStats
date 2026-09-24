import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import ConfirmModal from "../components/Training/ConfirmModal";
import TripMap, { type TripMapContent } from "../components/Trips/TripMap";
import StationEditor from "../components/Roadtrips/StationEditor";
import StationTimeline from "../components/Roadtrips/StationTimeline";
import { useTranslation } from "../hooks/useTranslation";
import { useDomainColors } from "../hooks/useDomainColors";
import { roadtripsApi, toStationInput } from "../lib/api/roadtrips";
import { toursApi } from "../lib/api/tours";
import { useDisplayFormat } from "../lib/displayFormat";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { hexToRgb } from "../lib/domainColor";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { RoadtripDetail, RoadtripStation, StationInput } from "../types/roadtrip";
import type { TourGeometry } from "../types/tour";

/**
 * One roadtrip, laid out like a cruise (design 2026-09-24, planning page
 * "Entwurf 1"): the figures up top, the map, then the stations by day.
 *
 * Only the station list is edited here. Legs, routing and recorded tracks are
 * the tour editor's (`/tours/:id`) — a roadtrip is a tour route underneath,
 * and one editor for legs is one place for leg bugs.
 */
export default function RoadtripDetailPage(): JSX.Element {
  const { id = "" } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation(["roadtrips", "common"]);
  const display = useDisplayFormat();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const roadtripColor = useDomainColors().colorOf("roadtrip");
  const nf = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }),
    [i18n.language]
  );

  const [detail, setDetail] = useState<RoadtripDetail | null>(null);
  const [geometry, setGeometry] = useState<TourGeometry | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  const mapContent = useMemo<TripMapContent>(
    () => ({
      stops: (detail?.stations ?? []).map((s) => ({
        title: s.title,
        lat: s.lat,
        lon: s.lon,
        // A night at a stay is drawn in the stay's colour, everything else in
        // the roadtrip's — the same split the chips below make.
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

  const saveStations = async (stations: StationInput[]): Promise<void> => {
    setSaving(true);
    try {
      await roadtripsApi.replaceStations(id, stations);
      if (!mountedRef.current) return;
      setEditing(false);
      await load();
    } catch {
      if (mountedRef.current) addToast("error", t("roadtrips:stations.saveError"));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

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

  if (loadError) {
    return (
      <AppShell width="list">
        <div className="rounded-lg border border-(--color-border) bg-(--bg-surface) p-4 text-sm">
          <p style={{ color: "var(--danger)" }}>{t("roadtrips:detailLoadError")}</p>
          <button type="button" className="mt-2 underline" onClick={() => void load()}>
            {t("common:buttons.retry")}
          </button>
        </div>
      </AppShell>
    );
  }
  if (!detail) {
    return (
      <AppShell width="list">
        <div className="py-10 text-center text-sm text-(--text-muted)">
          {t("common:loading.default")}
        </div>
      </AppShell>
    );
  }

  const r = detail.roadtrip;
  const span =
    detail.startDate === null
      ? t("roadtrips:undated")
      : `${display.date(detail.startDate, { timeZone: "UTC" })}${
          detail.endDate && detail.endDate !== detail.startDate
            ? ` – ${display.date(detail.endDate, { timeZone: "UTC" })}`
            : ""
        }`;
  const days =
    detail.startDate && detail.endDate
      ? Math.round(
          (Date.parse(detail.endDate.slice(0, 10)) - Date.parse(detail.startDate.slice(0, 10))) /
            86_400_000
        ) + 1
      : null;
  const stayLabels = Object.fromEntries(
    detail.stations.filter((s) => s.stay).map((s) => [s.id, s.stay!.lodgingName])
  );

  const figures: Array<{ value: string; label: string }> = [
    { value: `${nf.format(r.distanceKm)} km`, label: t("roadtrips:figures.km") },
    ...(days !== null ? [{ value: nf.format(days), label: t("roadtrips:figures.days") }] : []),
    {
      value: `${nf.format(detail.nights.nights)}${detail.nights.nightsKnown ? "" : " *"}`,
      label: t("roadtrips:figures.nights", { places: detail.nights.placesSlept }),
    },
    { value: nf.format(detail.countries.length), label: t("roadtrips:figures.countries") },
    { value: nf.format(detail.tours.length), label: t("roadtrips:figures.tours") },
  ];

  return (
    <AppShell width="list">
      <nav className="mb-2 text-sm">
        <Link to="/roadtrips" className="underline">
          {t("roadtrips:backToList")}
        </Link>
      </nav>
      <header className="mb-3 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="t-screen-title">{r.name}</h1>
        </div>
        <p className="text-sm text-(--text-muted)">
          {[
            r.vehicle ? t(`roadtrips:vehicle.${r.vehicle}`) : null,
            r.vehicleName,
            span,
            detail.trip ? t("roadtrips:inTrip", { name: detail.trip.name }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      <dl
        className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-(--color-border) sm:grid-cols-5"
        style={{ background: "var(--color-border)" }}
      >
        {figures.map((f) => (
          <div key={f.label} className="p-3" style={{ background: "var(--bg-elevated)" }}>
            <dt className="text-xs text-(--text-muted)">{f.label}</dt>
            <dd className="t-stat-number">{f.value}</dd>
          </div>
        ))}
      </dl>
      {!detail.nights.nightsKnown && (
        <p className="-mt-2 mb-4 text-xs text-(--text-muted)">{t("roadtrips:nightsSoft")}</p>
      )}

      <div className="mb-4 overflow-hidden rounded-lg border border-(--color-border)">
        <TripMap trip={mapContent} tourGeometries={mapGeometries} />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="t-card-title">{t("roadtrips:stations.title")}</h2>
          {!editing && (
            <div className="flex flex-wrap gap-2 text-sm">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-sm border border-(--color-border) px-3 py-1.5 hover:bg-(--bg-surface)"
              >
                {t("roadtrips:stations.edit")}
              </button>
              <Link
                to={`/tours/${id}`}
                className="rounded-sm border border-(--color-border) px-3 py-1.5 hover:bg-(--bg-surface)"
              >
                {t("roadtrips:editLegs")}
              </Link>
            </div>
          )}
        </div>
        {editing ? (
          <StationEditor
            initial={detail.stations.filter((s) => s.lat !== null).map(toStationInput)}
            initialStayLabels={stayLabels}
            tripId={detail.trip?.id ?? null}
            saving={saving}
            onSave={(stations) => void saveStations(stations)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <StationTimeline
            stations={detail.stations}
            legs={detail.legs}
            tours={detail.tours}
            onStartTour={(s) => void startTour(s)}
          />
        )}
      </section>

      <footer className="mt-8 border-t border-(--color-border) pt-4 text-sm">
        <button type="button" className="underline" onClick={() => setConfirmDelete(true)}>
          {t("roadtrips:delete")}
        </button>
      </footer>

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
