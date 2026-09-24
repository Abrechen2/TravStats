import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import TripMap, { type TripMapContent } from "../components/Trips/TripMap";
import TourRecordingSummary from "../components/Trips/TourRecordingSummary";
import PlannedProfileCard from "../components/Trips/PlannedProfileCard";
import StravaImportDialog, { useStravaConnected } from "../components/Trips/StravaImportDialog";
import { useDomainColors } from "../hooks/useDomainColors";
import { hexToRgb } from "../lib/domainColor";
import { TOUR_COLOR } from "../shared/domains";
import { TOUR_ACTIVITIES, type TourActivity } from "../shared/tour/roadtrip";
import TourStopAssigner from "../components/Trips/TourStopAssigner";
import TourPointEditor from "../components/Trips/TourPointEditor";
import TourLegList from "../components/Trips/TourLegList";
import TourTrackList from "../components/Trips/TourTrackList";
import { useTranslation } from "../hooks/useTranslation";
import { useTourTracks } from "../hooks/useTourTracks";
import { tripsApi } from "../lib/api";
import { toursApi, type TourPointInput } from "../lib/api/tours";
import { dawarichFailureKey, dawarichFailureKind } from "../lib/api/dawarich";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { findCoveringTrackId } from "../lib/trackCoverage";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { Trip, TripStop } from "../types";
import type { TourGeometry, TourLeg, TourRoute, TourStop, TourTrackMeta } from "../types/tour";

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
 * The HTTP status of a failed request, if this is an axios-shaped error.
 * Used to tell the routing endpoint's deliberate 409 ("instance not
 * equipped to route at all") apart from every other failure — a network
 * drop, a 404 for a leg that no longer exists, a 500. Only the 409 gets its
 * own message; everything else falls back to the generic routing error.
 */
function apiErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { response?: { status?: unknown } }).response?.status;
  return typeof status === "number" ? status : null;
}

/**
 * The route editor: `/trips/:id/route/:routeId`. Where a tour section
 * becomes usable — assign stops, see the line on the map, adjust a leg's
 * source.
 *
 * `load()` reads the section via `toursApi.get`, a plain `GET
 * /trips/:id/routes/:routeId` (added in Task 14's fix round 1). Its `404`
 * IS the "section not found" signal — no separate `list()` call is needed
 * just to check the route exists. An earlier version of this page instead
 * re-sent the section's own current stop order through the WRITE endpoint
 * (`assignStops`) as a deliberate no-op just to get a payload shaped like
 * this one back; that was unsound for a page LOAD — the write endpoint
 * opens a transaction, takes a row lock on every one of the section's
 * stops, and its 409 guard exists precisely because concurrent claims are
 * expected, so merely opening the editor could fail on a lock collision or
 * race a genuine concurrent write. A read must never be able to lose
 * someone else's write.
 */
export default function TripRouteEditorPage(): JSX.Element {
  const { id, routeId } = useParams<{ id: string; routeId: string }>();
  const { t } = useTranslation(["trips", "roadtrips", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const { colorOf } = useDomainColors();
  const stravaConnected = useStravaConnected();
  const [stravaOpen, setStravaOpen] = useState(false);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [route, setRoute] = useState<TourRoute | null>(null);
  const [legs, setLegs] = useState<TourLeg[]>([]);
  /* The section's OWN points, as the endpoint returns them. For a tour on
     a trip they are a subset of `trip.stops` and the assigner works from
     the trip; for a standalone tour there is no trip, and these are the
     only points there are. */
  const [sectionStops, setSectionStops] = useState<TourStop[]>([]);
  const [savingPoints, setSavingPoints] = useState(false);
  const [geometry, setGeometry] = useState<TourGeometry | null>(null);
  // Whether a routing provider is configured and usable right now — see
  // `routingAvailable` on `toursApi.get()`. Defaults to `false` (never a
  // guessed `true`) so a slow/failed load never briefly offers a control
  // that would just 409.
  const [routingAvailable, setRoutingAvailable] = useState(false);
  const [routingAllInProgress, setRoutingAllInProgress] = useState(false);
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
    if (!routeId) return;
    setFailure(null);
    try {
      /* `id` is absent on `/tours/:routeId` — a tour that belongs to no
         trip. Then there is no trip to fetch and none to show; every
         section call takes the trip-less path instead (see `sectionPath`
         in `lib/api/tours.ts`), so the rest of this page is unchanged. */
      const [tripData, sectionData, geometryData] = await Promise.all([
        id === undefined ? Promise.resolve(null) : tripsApi.getById(id),
        toursApi.get(id, routeId),
        toursApi.geometry(id, routeId),
      ]);
      if (!mountedRef.current) return;

      setTrip(tripData);
      setRoute(sectionData.route);
      setLegs(sectionData.legs);
      setSectionStops(sectionData.stops);
      setRoutingAvailable(sectionData.routingAvailable);
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

  // Recorded tracks (phase 3b, task 8) — a genuinely separate concern from
  // this page's own section/leg state, pulled into its own hook so this
  // file stays readable. Loaded and reported INDEPENDENTLY of `failure`
  // above, so a track-list hiccup never turns into "this section does not
  // exist" — the track list gets its own honest loading/error/empty
  // states instead of inheriting the page's.
  const {
    tracks,
    tracksLoading,
    tracksLoadError,
    loadTracks,
    tracksWithGeometry,
    tracksKnown,
    trackUploading,
    uploadTrack,
    trackPulling,
    pullDawarichTrack,
    deleteTrack,
    dawarichAvailable,
  } = useTourTracks(id, routeId);

  // Every trip stop, annotated for THIS section only. A stop assigned to a
  // DIFFERENT section still shows up (so the user can see it exists and try
  // to claim it), but its switch reads as "off" here — `routeOrderIdx` is
  // deliberately nulled out unless the stop belongs to THIS route, because
  // `TourStopAssigner` has no other way to tell "not in any section" apart
  // from "in a section that is not this one".
  const assignerStops = useMemo<TourStop[]>(() => {
    // No trip means no timeline to choose from: the section's own points
    // ARE the list, and they are all already on it.
    if (trip === null) return sectionStops;
    const stopsWithRoute = (trip.stops ?? []) as unknown as StopWithRoute[];
    return stopsWithRoute.map((s) => ({
      id: s.id,
      title: s.title,
      lat: s.lat,
      lon: s.lon,
      routeOrderIdx: s.routeId === routeId ? s.routeOrderIdx : null,
    }));
  }, [trip, sectionStops, routeId]);

  const stopTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of assignerStops) map.set(s.id, s.title);
    return map;
  }, [assignerStops]);

  const stopCoordById = useMemo(() => {
    const map = new Map<string, { lat: number; lon: number }>();
    for (const s of assignerStops) {
      if (s.lat !== null && s.lon !== null) map.set(s.id, { lat: s.lat, lon: s.lon });
    }
    return map;
  }, [assignerStops]);

  /**
   * legId -> id of the recorded track that covers it, powering
   * `TourLegList`'s "track" option gate. See `lib/trackCoverage.ts` —
   * `tracksWithGeometry` is already in `toursApi.tracks.list`'s
   * oldest-started-first order, so "first match" there is a deterministic
   * choice, not an arbitrary one.
   */
  const trackCoverageByLegId = useMemo(() => {
    const map = new Map<string, string>();
    for (const leg of legs) {
      const from = stopCoordById.get(leg.fromStopId);
      const to = stopCoordById.get(leg.toStopId);
      if (!from || !to) continue;
      const trackId = findCoveringTrackId(tracksWithGeometry, from, to);
      if (trackId) map.set(leg.id, trackId);
    }
    return map;
  }, [legs, stopCoordById, tracksWithGeometry]);

  // `TripMap` was specifically changed to protect its layer `useMemo` with a
  // stable default (`NO_TOUR_GEOMETRIES`) when no `tourGeometries` prop is
  // passed at all — but this page always passes one, and a fresh array
  // literal built inline in JSX on every render defeats that protection just
  // as completely as omitting the prop would help it. `react-hooks/exhaustive-deps`
  // is disabled repo-wide, so the dependency array here is hand-picked to
  // match exactly what the constructed object reads: `route.id`/`route.name`
  // (not the whole `route` object, whose other fields like `distanceKm`
  // change on every reload without touching this array's shape) and `geometry`.
  const roadtripHex = colorOf("roadtrip");
  // The recordings, drawn as lines of their own. For a day tour the track IS
  // the route — its points are often none at all — so a map without it
  // showed an empty world. Keyed on the ids: `tracksWithGeometry` is a fresh
  // array on every render.
  const recordedKey = tracksWithGeometry.map((tr) => tr.id).join(",");
  const recordingGeometry = useMemo<TourGeometry | null>(
    () =>
      tracksWithGeometry.length === 0
        ? null
        : {
            type: "FeatureCollection",
            features: tracksWithGeometry.map((tr) => ({
              type: "Feature",
              geometry: { type: "LineString", coordinates: [...tr.geometry] },
              properties: {
                legId: `track:${tr.id}`,
                source: "track",
                mode: route?.mode ?? "foot",
                confidence: "high",
                distanceKm: tracks.find((x) => x.id === tr.id)?.distanceKm ?? 0,
              },
            })),
          },
    [recordedKey, route?.mode]
  );
  const tourGeometries = useMemo(() => {
    if (!route) return [];
    // A roadtrip's line in its own domain hue (2.7); a tour keeps the tour hue.
    const rgb = route.kind === "roadtrip" ? hexToRgb(roadtripHex) : undefined;
    return [
      ...(geometry ? [{ routeId: route.id, name: route.name, geometry, rgb }] : []),
      ...(recordingGeometry
        ? [{ routeId: `${route.id}:tracks`, name: route.name, geometry: recordingGeometry, rgb }]
        : []),
    ];
  }, [geometry, recordingGeometry, route?.id, route?.name, route?.kind, roadtripHex]);

  /**
   * What the map draws when there is no trip: the tour's own points. A
   * standalone tour used to get no map at all, because the map could only
   * draw a TRIP; since 2.7 it draws whatever content it is handed.
   */
  const mapContent = useMemo<TripMapContent>(
    () =>
      trip ?? {
        stops: sectionStops.map((s) => ({
          title: s.title,
          lat: s.lat,
          lon: s.lon,
          domain: "tour",
        })),
      },
    [trip, sectionStops]
  );

  const handleActivityChange = useCallback(
    async (activity: TourActivity | null): Promise<void> => {
      if (!route) return;
      try {
        const updated = await toursApi.update(id, route.id, { activity });
        setRoute(updated);
      } catch {
        addToast("error", t("roadtrips:activitySaveError"));
      }
    },
    [route, id, addToast, t]
  );

  /**
   * The standalone tour's write path: one call replaces the whole point
   * list, and the response carries the section, its points and the
   * recomputed legs — so nothing is re-read and the page cannot briefly
   * show a list that disagrees with its own kilometres.
   */
  const handleSavePoints = useCallback(
    async (points: TourPointInput[]): Promise<void> => {
      if (!routeId) return;
      setSavingPoints(true);
      try {
        const result = await toursApi.replacePoints(routeId, points);
        if (!mountedRef.current) return;
        setRoute(result.route);
        setSectionStops(result.stops);
        setLegs(result.legs);
        // The geometry is derived from the legs that just changed; it is
        // the one thing the write does not return.
        setGeometry(await toursApi.geometry(undefined, routeId));
      } catch {
        if (mountedRef.current) addToast("error", t("trips:tours.points.saveError"));
      } finally {
        if (mountedRef.current) setSavingPoints(false);
      }
    },
    [routeId, addToast, t]
  );

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
    (leg: TourLeg, source: "straight" | "drawn"): void => {
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

  /**
   * Routes ONE leg through the configured provider. The 409 "no provider
   * configured" answer gets its OWN message — a generic
   * "could not be changed" toast would read as a validation failure, but
   * this is the instance not being equipped to answer at all, which
   * `TourLegList` already prevents by disabling the option in the common
   * case; this still guards the request directly (a second tab could have
   * unconfigured routing between load and click). A 200 with a low-confidence
   * fallback is not an error — `load()` picks up the honest result (source
   * reverts to "straight") and a distinct info toast says so, rather than
   * silently looking like nothing happened.
   */
  const handleRouteLeg = useCallback(
    (leg: TourLeg): void => {
      if (!id || !routeId) return;
      void (async (): Promise<void> => {
        try {
          const routed = await toursApi.routeLeg(id, routeId, leg.fromStopId, leg.toStopId);
          await load();
          if (routed.confidence === "low") {
            addToast("info", t("trips:tours.routing.fallback"));
          }
        } catch (err) {
          if (apiErrorStatus(err) === 409) {
            addToast("error", t("trips:tours.routing.notConfigured"));
          } else {
            addToast("error", apiErrorMessage(err) ?? t("trips:tours.routing.error"));
          }
        }
      })();
    },
    [id, routeId, load, addToast, t]
  );

  /**
   * Routes every routable leg of the section in one call. Never 409s (see
   * `toursApi.routeAll`'s own doc comment), so the only failure path here
   * is a genuine request error (network, 500). On success, `load()` is
   * re-run rather than applying `result.legs` directly — routing can change
   * `route.distanceKm`/`drivenKm` (the header) and the drawn line
   * (`geometry`, fetched separately for the map), so only a full reload
   * keeps every part of the page honest. The counts are then reported
   * verbatim — never a blanket "done!" toast, which would hide a batch
   * that quietly routed zero legs because no provider is configured.
   */
  const handleRouteAll = useCallback((): void => {
    if (!id || !routeId) return;
    setRoutingAllInProgress(true);
    void (async (): Promise<void> => {
      try {
        const result = await toursApi.routeAll(id, routeId);
        await load();
        if (!mountedRef.current) return;
        addToast(
          "info",
          t("trips:tours.routing.result", {
            routed: result.routedCount,
            skipped: result.skippedCount,
          })
        );
      } catch (err) {
        addToast("error", apiErrorMessage(err) ?? t("trips:tours.routing.allError"));
      } finally {
        if (mountedRef.current) setRoutingAllInProgress(false);
      }
    })();
  }, [id, routeId, load, addToast, t]);

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

  /**
   * Adopts a track's geometry onto a leg (phase 3b, task 8). Only ever
   * invoked by `TourLegList` for a leg whose "track" option is enabled —
   * gated client-side by `trackCoverageByLegId` — but the server re-checks
   * coverage itself and answers 409 with an exact reason if it disagrees
   * (a race: the track could have been deleted between render and click).
   * `apiErrorMessage` already surfaces that 409's own prose, so no special
   * status handling is needed here, unlike `handleRouteLeg`'s 409 case.
   */
  const handleAdoptTrack = useCallback(
    (leg: TourLeg, trackId: string): void => {
      if (!id || !routeId) return;
      void (async (): Promise<void> => {
        try {
          await toursApi.setLeg(id, routeId, leg.fromStopId, leg.toStopId, {
            source: "track",
            trackId,
          });
          await load();
        } catch (err) {
          addToast("error", apiErrorMessage(err) ?? t("trips:tours.legError"));
        }
      })();
    },
    [id, routeId, load, addToast, t]
  );

  const handleUploadTrack = useCallback(
    (file: File): void => {
      void (async (): Promise<void> => {
        try {
          await uploadTrack(file);
        } catch (err) {
          // A malformed GPX and a GPX with no timestamps both 400 with
          // DIFFERENT server messages (see `toursApi.tracks.upload`'s own
          // doc comment) — surface whichever one the server sent.
          addToast("error", apiErrorMessage(err) ?? t("trips:tours.tracks.uploadError"));
        }
      })();
    },
    [uploadTrack, addToast, t]
  );

  const handleDeleteTrack = useCallback(
    (track: TourTrackMeta): void => {
      void (async (): Promise<void> => {
        try {
          await deleteTrack(track.id);
        } catch (err) {
          addToast("error", apiErrorMessage(err) ?? t("trips:tours.tracks.deleteError"));
        }
      })();
    },
    [deleteTrack, addToast, t]
  );

  /**
   * Pulls the section's own date span from Dawarich (an empty body — the
   * server derives the window from the section's stops). Three failure
   * shapes, per `toursApi.tracks.pullDawarich`'s doc comment: a fixed-kind
   * 409 (`dawarichFailureKind` parses it, `notConfigured` included), or
   * plain prose with no kind (an empty window, or no dated stops to derive
   * one from) — the fallback branch surfaces that prose verbatim rather
   * than a generic message.
   */
  const handlePullDawarich = useCallback((): void => {
    void (async (): Promise<void> => {
      try {
        await pullDawarichTrack();
      } catch (err) {
        const kind = dawarichFailureKind(err);
        addToast(
          "error",
          kind
            ? t(dawarichFailureKey(kind))
            : (apiErrorMessage(err) ?? t("trips:tours.tracks.dawarich.error"))
        );
      }
    })();
  }, [pullDawarichTrack, addToast, t]);

  if (loading) {
    return (
      <AppShell width="list">
        <div className="flex items-center justify-center py-20 text-(--text-muted)">
          {t("common:loading.default")}
        </div>
      </AppShell>
    );
  }

  // A standalone tour (and a roadtrip) has no trip, so `trip === null` is its
  // normal state, not a failure. Only a TRIP section needs its trip loaded.
  // This read `!trip` alone until 2026-09-24, which turned every standalone
  // tour's page into "could not be loaded" — found in the browser.
  if (failure || !route || (id !== undefined && !trip)) {
    return (
      <AppShell width="reading">
        <div className="py-16 text-center">
          <p className="text-sm text-rose-400">
            {failure === "notFound" ? t("trips:tours.notFound") : t("trips:tours.loadError")}
          </p>
          {failure === "loadError" && (
            <button type="button" className="mt-3 underline text-sm" onClick={() => void load()}>
              {t("common:buttons.retry")}
            </button>
          )}
          <div className="mt-6">
            <Link to={id ? `/trips/${id}?tab=tours` : "/tours"} className="text-sm underline">
              {t("trips:tours.backToTrip")}
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell width="list">
      <div className="space-y-6">
        <header>
          <Link
            to={
              route.kind === "roadtrip"
                ? `/roadtrips/${route.id}`
                : id
                  ? `/trips/${id}?tab=tours`
                  : "/tours"
            }
            className="text-xs text-(--text-muted) hover:underline"
          >
            ←{" "}
            {route.kind === "roadtrip"
              ? t("roadtrips:backToRoadtrip")
              : t(id ? "trips:tours.backToTrip" : "trips:tours.backToTours")}
          </Link>
          <h1 className="t-screen-title mt-1">{route.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-(--text-muted)">
            {route.kind === "tour" && (
              <select
                id="tour-activity"
                value={route.activity ?? ""}
                onChange={(e) =>
                  void handleActivityChange((e.target.value || null) as TourActivity | null)
                }
                aria-label={t("roadtrips:activityLabel")}
                className="rounded-sm border border-(--color-border) bg-transparent px-2 py-0.5 text-sm"
              >
                <option value="">{t("roadtrips:activityNone")}</option>
                {TOUR_ACTIVITIES.map((a) => (
                  <option key={a} value={a}>
                    {t(`roadtrips:activity.${a}`)}
                  </option>
                ))}
              </select>
            )}
            <span>
              {t(`trips:tours.mode.${route.mode}`)} ·{" "}
              {/* A day tour is measured by its recording once it has one. */}
              {formatKm(
                route.kind === "tour" && tracks.length > 0
                  ? tracks.reduce((sum, tr) => sum + tr.distanceKm, 0)
                  : route.distanceKm
              )}{" "}
              km
            </span>
          </p>
        </header>

        {route.kind === "tour" && (
          <TourRecordingSummary
            tracks={tracks}
            tripId={id}
            routeId={route.id}
            accent={TOUR_COLOR}
          />
        )}
        {route.kind === "tour" && tracksKnown && tracks.length === 0 && legs.length > 0 && (
          <PlannedProfileCard
            routeId={route.id}
            lineKey={legs
              .map((l) => `${l.fromStopId}-${l.toStopId}-${l.source}-${l.distanceKm}`)
              .join("|")}
            accent={TOUR_COLOR}
          />
        )}

        {/* A trip's section draws the whole trip around it; a standalone
            tour or a roadtrip draws its own points (see `mapContent`). */}
        <TripMap trip={mapContent} tourGeometries={tourGeometries} />

        <section>
          <h2 className="text-lg font-semibold mb-3">
            {trip === null ? t("trips:tours.points.heading") : t("trips:tours.stopsHeading")}
          </h2>
          {trip === null ? (
            <TourPointEditor
              points={sectionStops.map((s) => ({
                id: s.id,
                title: s.title,
                lat: s.lat ?? NaN,
                lon: s.lon ?? NaN,
              }))}
              saving={savingPoints}
              onSave={(points) => void handleSavePoints(points)}
            />
          ) : (
            <TourStopAssigner stops={assignerStops} onChange={handleAssignChange} />
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">{t("trips:tours.legsHeading")}</h2>
          <TourLegList
            legs={legs}
            stopTitleById={stopTitleById}
            routingAvailable={routingAvailable}
            onSetSource={handleSetLegSource}
            onRoute={handleRouteLeg}
            trackCoverageByLegId={trackCoverageByLegId}
            tracksKnown={tracksKnown}
            onAdoptTrack={handleAdoptTrack}
            onClear={handleClearLeg}
            onRouteAll={handleRouteAll}
            routingAllInProgress={routingAllInProgress}
          />
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">{t("trips:tours.tracks.heading")}</h2>
          <TourTrackList
            tracks={tracks}
            loading={tracksLoading}
            loadError={tracksLoadError}
            onRetry={loadTracks}
            uploading={trackUploading}
            onUpload={handleUploadTrack}
            onDelete={handleDeleteTrack}
            pulling={trackPulling}
            dawarichAvailable={dawarichAvailable}
            onPullDawarich={handlePullDawarich}
            onImportStrava={stravaConnected ? () => setStravaOpen(true) : undefined}
          />
          {stravaOpen && route && (
            <StravaImportDialog
              target={{ kind: "route", routeId: route.id }}
              around={tracks[0]?.startedAt ?? null}
              onClose={() => setStravaOpen(false)}
              onDone={() => {
                setStravaOpen(false);
                void loadTracks();
              }}
            />
          )}
        </section>
      </div>
    </AppShell>
  );
}
