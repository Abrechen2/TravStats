import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import TripMap from "../components/Trips/TripMap";
import TourStopAssigner from "../components/Trips/TourStopAssigner";
import TourLegList from "../components/Trips/TourLegList";
import { useTranslation } from "../hooks/useTranslation";
import { tripsApi } from "../lib/api";
import { toursApi } from "../lib/api/tours";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { Trip, TripStop } from "../types";
import type { LegSource, TourGeometry, TourLeg, TourRoute, TourStop } from "../types/tour";

/**
 * `TripStop` (`types/index.ts`) does not declare `routeId`/`routeOrderIdx` —
 * no other frontend consumer needed them before this page. The backend DOES
 * send them: `GET /trips/:id` includes every trip stop with `stops: {
 * orderBy: [...] }` and NO `select`, i.e. every scalar column, and
 * `TripStop.routeId`/`routeOrderIdx` are plain columns on that Prisma model
 * (`backend/prisma/schema.prisma`). Extending locally rather than editing
 * the shared type keeps this task's file list to what it says on the tin.
 */
interface StopWithRoute extends TripStop {
  routeId: string | null;
  routeOrderIdx: number | null;
}

function formatKm(value: number): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

/** Pull the backend's plain-text `{ error: "..." }` body out of a failed request. */
function apiErrorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const response = (error as { response?: { data?: { error?: unknown } } }).response;
  const message = response?.data?.error;
  return typeof message === "string" ? message : null;
}

/**
 * The route editor: `/trips/:id/route/:routeId`. Where a tour section
 * becomes usable — assign stops, see the line on the map, adjust a leg's
 * source.
 *
 * There is no `GET` endpoint that returns one section's legs on their own
 * (`tourRoutes.ts` / `tourLegs.ts` only expose the list of sections, the
 * geometry, and the stops-assignment write). `PUT .../stops` is the only
 * response shape that carries legs WITH their `fromStopId`/`toStopId` —
 * `GET .../geometry`'s features carry a `legId` but not the stop pair. So
 * `load()` re-sends the section's OWN current stop order through
 * `assignStops` as a deliberate no-op refresh: sending the identical
 * ordered list changes nothing (`recomputeLegs` keeps every leg whose
 * endpoint pair survives, exactly as it is), and in return this page gets
 * back the one payload that actually has what the leg list needs to render.
 */
export default function TripRouteEditorPage(): JSX.Element {
  const { id, routeId } = useParams<{ id: string; routeId: string }>();
  const { t } = useTranslation(["trips", "common"]);
  const addToast = useToastStore((s) => s.addToast);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [route, setRoute] = useState<TourRoute | null>(null);
  const [legs, setLegs] = useState<TourLeg[]>([]);
  const [geometry, setGeometry] = useState<TourGeometry | null>(null);
  const [loading, setLoading] = useState(true);
  // `null` = loaded fine so far; a value distinguishes "record is gone"
  // (404) from "could not ask" (anything else) — same two-valued
  // vocabulary `lib/api/loadFailure.ts` already uses for cruise/lodging
  // detail pages, so a dropped connection never reads as "this section
  // does not exist".
  const [failure, setFailure] = useState<LoadFailure | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (!id || !routeId) return;
    setFailure(null);
    try {
      const [tripData, routes, geometryData] = await Promise.all([
        tripsApi.getById(id),
        toursApi.list(id),
        toursApi.geometry(id, routeId),
      ]);
      if (!mountedRef.current) return;

      const matchedRoute = routes.find((r) => r.id === routeId);
      if (!matchedRoute) {
        setFailure("notFound");
        return;
      }

      const stopsWithRoute = (tripData.stops ?? []) as unknown as StopWithRoute[];
      const orderedIds = stopsWithRoute
        .filter((s) => s.routeId === routeId && s.routeOrderIdx !== null)
        .sort((a, b) => (a.routeOrderIdx ?? 0) - (b.routeOrderIdx ?? 0))
        .map((s) => s.id);

      let finalRoute = matchedRoute;
      let finalLegs: TourLeg[] = [];
      if (orderedIds.length > 0) {
        const synced = await toursApi.assignStops(id, routeId, orderedIds);
        if (!mountedRef.current) return;
        finalRoute = synced.route;
        finalLegs = synced.legs;
      }

      setTrip(tripData);
      setRoute(finalRoute);
      setLegs(finalLegs);
      setGeometry(geometryData);
    } catch (err) {
      if (!mountedRef.current) return;
      logger.warn("TripRouteEditorPage: failed to load route", err);
      setFailure(classifyLoadFailure(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [id, routeId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Every trip stop, annotated for THIS section only. A stop assigned to a
  // DIFFERENT section still shows up (so the user can see it exists and try
  // to claim it), but its switch reads as "off" here — `routeOrderIdx` is
  // deliberately nulled out unless the stop belongs to THIS route, because
  // `TourStopAssigner` has no other way to tell "not in any section" apart
  // from "in a section that is not this one".
  const assignerStops = useMemo<TourStop[]>(() => {
    const stopsWithRoute = (trip?.stops ?? []) as unknown as StopWithRoute[];
    return stopsWithRoute.map((s) => ({
      id: s.id,
      title: s.title,
      lat: s.lat,
      lon: s.lon,
      routeOrderIdx: s.routeId === routeId ? s.routeOrderIdx : null,
    }));
  }, [trip, routeId]);

  const stopTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of assignerStops) map.set(s.id, s.title);
    return map;
  }, [assignerStops]);

  const handleAssignChange = useCallback(
    (orderedIds: string[]): void => {
      if (!id || !routeId) return;
      void (async (): Promise<void> => {
        try {
          await toursApi.assignStops(id, routeId, orderedIds);
          await load();
        } catch (err) {
          // A stop with no coordinate is filtered out client-side, but a
          // stop already claimed by another section (400) or one lost to a
          // concurrent claim (409) can only be found out by asking — both
          // must read as an actual message, never a switch that silently
          // flips back with no explanation.
          addToast("error", apiErrorMessage(err) ?? t("trips:tours.assignError"));
        }
      })();
    },
    [id, routeId, load, addToast, t]
  );

  const handleSetLegSource = useCallback(
    (leg: TourLeg, source: LegSource): void => {
      if (!id || !routeId) return;
      void (async (): Promise<void> => {
        try {
          await toursApi.setLeg(id, routeId, leg.fromStopId, leg.toStopId, { source });
          await load();
        } catch (err) {
          addToast("error", apiErrorMessage(err) ?? t("trips:tours.legError"));
        }
      })();
    },
    [id, routeId, load, addToast, t]
  );

  const handleClearLeg = useCallback(
    (leg: TourLeg): void => {
      if (!id || !routeId) return;
      void (async (): Promise<void> => {
        try {
          await toursApi.clearLeg(id, routeId, leg.fromStopId, leg.toStopId);
          await load();
        } catch (err) {
          addToast("error", apiErrorMessage(err) ?? t("trips:tours.legError"));
        }
      })();
    },
    [id, routeId, load, addToast, t]
  );

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-muted)" }}>
        <NavigationBar />
        <div className="flex items-center justify-center py-20">{t("common:loading.default")}</div>
      </div>
    );
  }

  if (failure || !trip || !route) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
        <NavigationBar />
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <p className="text-sm text-rose-400">
            {failure === "notFound" ? t("trips:tours.notFound") : t("trips:tours.loadError")}
          </p>
          {failure === "loadError" && (
            <button type="button" className="mt-3 underline text-sm" onClick={() => void load()}>
              {t("common:buttons.retry")}
            </button>
          )}
          <div className="mt-6">
            <Link to={id ? `/trips/${id}` : "/trips"} className="text-sm underline">
              {t("trips:tours.backToTrip")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
        <NavigationBar />
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          <header>
            <Link to={`/trips/${id}`} className="text-xs text-(--text-muted) hover:underline">
              ← {t("trips:tours.backToTrip")}
            </Link>
            <h1 className="text-xl font-semibold mt-1">{route.name}</h1>
            <p className="text-sm text-(--text-muted)">
              {t(`trips:tours.mode.${route.mode}`)} · {formatKm(route.distanceKm)} km
            </p>
          </header>

          <TripMap
            trip={trip}
            tourGeometries={geometry ? [{ routeId: route.id, name: route.name, geometry }] : []}
          />

          <section>
            <h2 className="text-lg font-semibold mb-3">{t("trips:tours.stopsHeading")}</h2>
            <TourStopAssigner stops={assignerStops} onChange={handleAssignChange} />
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">{t("trips:tours.legsHeading")}</h2>
            <TourLegList
              legs={legs}
              stopTitleById={stopTitleById}
              onSetSource={handleSetLegSource}
              onClear={handleClearLeg}
            />
          </section>
        </div>
      </div>
    </PageTransition>
  );
}
