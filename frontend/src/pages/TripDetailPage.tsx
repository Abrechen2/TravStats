import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { tripsApi } from "../lib/api";
import { formatDateInTimezone } from "../lib/dateUtils";
import { logger } from "../lib/logger";
import { sumByCurrency, tripCostSources } from "../lib/bookingCost";
import { formatAmount, formatCurrency } from "../lib/units";
import { assessStayPlausibility } from "../shared/stayPlausibility";
import { formatDateTimeInTimezone } from "../lib/dateUtils";
import { useSettingsStore } from "../store/settingsStore";
import { computeRailStates } from "../lib/timelineRail";
import { ExpandableEventCard } from "../components/Trip/ExpandableEventCard";
import { stripMarkdown } from "../lib/markdownPreview";
import { useToastStore } from "../store/toastStore";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { usePlacesVisible } from "../hooks/usePlacesVisible";
import { useTranslation } from "../hooks/useTranslation";
import type { Booking, Trip, TripJournalEntry, TripStop } from "../types";
import PageTransition from "../components/PageTransition";
import ConfirmModal from "../components/Training/ConfirmModal";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import NavigationBar from "../components/NavigationBar";
import TripModal from "../components/Trips/TripModal";
import TripHero from "../components/Trips/TripHero";
import JournalEntryModal from "../components/Trips/JournalEntryModal";
import JournalViewModal from "../components/Trips/JournalViewModal";
import JournalPreview from "../components/Trips/JournalPreview";
import StopModal from "../components/Trips/StopModal";
import BookingEditModal from "../components/Trips/BookingEditModal";
import TripMap from "../components/Trips/TripMap";
import TripGallery from "../components/Trips/TripGallery";
import TripSummaryPanel from "../components/Trips/TripSummaryPanel";
import TourSectionList from "../components/Trips/TourSectionList";
import {
  compareTimelineEvents,
  formatTimelineDate,
  isSupersededByPlaceVisit,
} from "../lib/tripTimeline";
import { listPlaces } from "../lib/api/places";
import { PLACE_CATEGORY_ICONS } from "../shared/placeCategories";
import type { Place, PlaceVisit } from "../types/place";

type TabKey = "overview" | "timeline" | "map" | "gallery" | "logistics" | "tours";
const TABS: TabKey[] = ["overview", "timeline", "map", "gallery", "logistics", "tours"];
const TAB_ICON: Record<TabKey, string> = {
  overview: "📋",
  timeline: "📅",
  map: "🗺",
  gallery: "📷",
  logistics: "🧾",
  tours: "🛣",
};

/**
 * Trip detail page with five tabs (Phase-1 iteration 2).
 *
 * - **Overview**: hero context (notes preview, latest items, side panels for
 *   companions / tags / countries).
 * - **Timeline**: chronological mix of flights and cruises rendered through
 *   `TripTimeline` (the multi-domain event list that was sitting unused).
 * - **Map**: placeholder. A trip-specific map comes once `TripStop`
 *   waypoints exist.
 * - **Gallery**: placeholder. Photos come once upload + storage are wired.
 * - **Logistics**: tabular flight + cruise + booking list (the previous
 *   single-pane linked-items view, promoted to a dedicated tab).
 */
export default function TripDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  // "cruise" and "flights" are here because the timeline entries expand to show
  // a cabin type and a seat class, whose words live in those namespaces. Without
  // them `t("cruise:cabinType.balcony")` cannot resolve and the raw key reaches
  // the screen — which is what a browser showed, and no test could.
  const { t, i18n } = useTranslation(["trips", "common", "cruise", "flights"]);
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("overview");
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Domain-gating: when the cruise/lodging domain is disabled, every tab
  // gets a trip copy with those segments stripped, so timeline, map, and
  // logistics stay domain-free without per-tab checks. A counter banner
  // below the tab bar tells the user the segments are hidden, not lost.
  const { isEnabled } = useEnabledDomains();
  const cruiseEnabled = isEnabled("cruise");
  const lodgingEnabled = isEnabled("lodging");
  const displayTrip = useMemo<Trip | null>(() => {
    if (trip === null || (cruiseEnabled && lodgingEnabled)) return trip;
    return {
      ...trip,
      cruises: cruiseEnabled ? trip.cruises : [],
      lodgingStays: lodgingEnabled ? trip.lodgingStays : [],
      _count: trip._count
        ? {
            ...trip._count,
            ...(cruiseEnabled ? {} : { cruises: 0 }),
            ...(lodgingEnabled ? {} : { lodgingStays: 0 }),
          }
        : trip._count,
    };
  }, [trip, cruiseEnabled, lodgingEnabled]);
  const hiddenCruiseCount = cruiseEnabled
    ? 0
    : (trip?._count?.cruises ?? trip?.cruises?.length ?? 0);
  const hiddenLodgingCount = lodgingEnabled
    ? 0
    : (trip?._count?.lodgingStays ?? trip?.lodgingStays?.length ?? 0);

  const load = async (): Promise<void> => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await tripsApi.getById(id);
      setTrip(data);
    } catch (err) {
      logger.warn("Failed to load trip", err);
      addToast("error", t("trips:toasts.loadError"));
      navigate("/trips");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const handleDelete = async (): Promise<void> => {
    if (!trip) return;
    try {
      await tripsApi.delete(trip.id);
      addToast("success", t("trips:toasts.deleted"));
      navigate("/trips");
    } catch {
      addToast("error", t("trips:toasts.deleteError"));
      setConfirmDelete(false);
    }
  };

  if (loading || !trip) {
    return (
      <div
        className="min-h-screen"
        style={{ background: "var(--bg-base)", color: "var(--text-muted)" }}
      >
        <NavigationBar />
        <div className="flex items-center justify-center py-20">{t("common:loading.default")}</div>
      </div>
    );
  }

  const shownTrip = displayTrip ?? trip;

  return (
    <PageTransition>
      <div
        className="min-h-screen"
        style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
      >
        <NavigationBar />
        <TripHero
          trip={shownTrip}
          locale={i18n.language}
          t={t}
          onEdit={() => setEditing(true)}
          onDelete={() => setConfirmDelete(true)}
        />

        <TabBar tab={tab} onChange={setTab} t={t} />

        <div className="max-w-7xl mx-auto px-4 py-6">
          {hiddenCruiseCount > 0 && (
            <div
              className="mb-4 rounded-lg px-4 py-2.5 text-xs"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--color-border)",
                color: "var(--text-muted)",
              }}
            >
              ⚓ {t("trips:detail.hiddenCruises", { count: hiddenCruiseCount })}
            </div>
          )}
          {hiddenLodgingCount > 0 && (
            <div
              className="mb-4 rounded-lg px-4 py-2.5 text-xs"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--color-border)",
                color: "var(--text-muted)",
              }}
            >
              🏨 {t("trips:detail.hiddenLodging", { count: hiddenLodgingCount })}
            </div>
          )}
          {tab === "overview" && (
            <OverviewTab
              trip={shownTrip}
              t={t}
              language={i18n.language}
              onChanged={() => void load()}
            />
          )}
          {tab === "timeline" && (
            <TimelineTab
              trip={shownTrip}
              onChanged={() => void load()}
              t={t}
              language={i18n.language}
            />
          )}
          {tab === "map" && <TripMap trip={shownTrip} />}
          {tab === "gallery" && (
            <TripGallery
              tripId={shownTrip.id}
              photos={shownTrip.photos ?? []}
              immichAlbums={shownTrip.immichAlbums ?? []}
              onChange={() => void load()}
            />
          )}
          {tab === "logistics" && (
            <LogisticsTab
              trip={shownTrip}
              t={t}
              language={i18n.language}
              onChanged={() => void load()}
            />
          )}
          {tab === "tours" && <TourSectionList tripId={shownTrip.id} />}
        </div>
      </div>

      {editing && (
        <TripModal
          trip={trip}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}

      {/* The old sentence named two of the three survivors and none of the
          losses. Deleting a trip cascades its PHOTOS — real files on disk —
          plus its stops and companions, and said nothing about any of them.
          That was the most expensive silence among the six dialogs. */}
      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        title={t("trips:deleteTripConfirmTitle")}
        message={t("trips:deleteTripConfirm", { name: trip.name })}
        confirmText={t("trips:deleteTrip")}
        cancelText={t("trips:modal.cancel")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />
    </PageTransition>
  );
}

interface TabBarProps {
  tab: TabKey;
  onChange: (tab: TabKey) => void;
  t: ReturnType<typeof useTranslation>["t"];
}

function TabBar({ tab, onChange, t }: TabBarProps): JSX.Element {
  // No tab is filtered here any more. "tours" was withheld behind the
  // `tourRoutes` beta gate until the owner released it (2026-09-01).
  return (
    <div
      className="sticky top-0 z-30"
      style={{
        background: "var(--bg-base)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto overflow-y-hidden">
        {TABS.map((key) => {
          const isActive = tab === key;
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              className="px-4 py-3.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 hover:text-(--text-primary)"
              style={{
                color: isActive ? "var(--accent)" : "var(--text-secondary)",
                borderColor: isActive ? "var(--accent)" : "transparent",
                marginBottom: -1,
              }}
            >
              <span className="mr-1.5">{TAB_ICON[key]}</span>
              {t(`trips:detail.tabs.${key}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────── Tab: Overview ─────────── */

function OverviewTab({
  trip,
  t,
  language,
  onChanged,
}: {
  trip: Trip;
  t: ReturnType<typeof useTranslation>["t"];
  language: string | undefined;
  onChanged: () => void;
}): JSX.Element {
  return (
    <>
      <TripStatsRow trip={trip} t={t} language={language} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        <div className="lg:col-span-2 space-y-4">
          <TripSummaryPanel trip={trip} t={t} onChanged={onChanged} />
          {trip.notes && <NotesPanel notes={trip.notes} t={t} />}
          {!trip.notes && (
            <div
              className="rounded-xl p-4 text-sm"
              style={{
                background: "var(--bg-surface)",
                border: "1px dashed var(--color-border)",
                color: "var(--text-muted)",
              }}
            >
              {t("trips:modal.notesPlaceholder")}
            </div>
          )}
        </div>
        <div className="space-y-4">
          {trip.companions.length > 0 && (
            <SidePanel title={t("trips:detail.companions")}>
              <div className="flex flex-wrap gap-2">
                {trip.companions.map((name) => (
                  <span
                    key={name}
                    className="px-2 py-1 rounded-full text-xs"
                    style={{
                      background: "var(--bg-muted)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {name}
                  </span>
                ))}
              </div>
            </SidePanel>
          )}
          {trip.tags.length > 0 && (
            <SidePanel title={t("trips:detail.tags")}>
              <div className="flex flex-wrap gap-1">
                {trip.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-sm text-xs"
                    style={{
                      background: "var(--bg-muted)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </SidePanel>
          )}
          {trip.countries.length > 0 && (
            <SidePanel title={t("trips:detail.countries")}>
              <div className="flex flex-wrap gap-1 font-mono text-xs">
                {trip.countries.map((cc) => (
                  <span
                    key={cc}
                    className="px-2 py-0.5 rounded-sm"
                    style={{
                      background: "var(--bg-muted)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {cc}
                  </span>
                ))}
              </div>
            </SidePanel>
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────── Tab: Timeline ─────────── */

type TimelineEvent =
  | {
      id: string;
      kind: "flight";
      date: string;
      title: string;
      subtitle: string | null;
      /** The row itself, so the entry can open in place. It is already on the
       *  trip payload -- see the note on `Trip["flights"]`. */
      flight: NonNullable<Trip["flights"]>[number];
    }
  | {
      id: string;
      kind: "cruise";
      date: string;
      title: string;
      subtitle: string | null;
      cruise: NonNullable<Trip["cruises"]>[number];
    }
  | {
      id: string;
      kind: "stop";
      date: string;
      stop: TripStop;
    }
  | {
      id: string;
      kind: "journal";
      date: string;
      entry: TripJournalEntry;
    }
  | {
      id: string;
      kind: "lodging-checkin" | "lodging-checkout";
      date: string;
      stay: NonNullable<Trip["lodgingStays"]>[number];
    }
  | {
      id: string;
      kind: "place-visit";
      date: string;
      place: Place;
      visit: PlaceVisit;
    };

const STOP_DOMAIN_ICON: Record<string, string> = {
  poi: "📍",
  hotel: "🏨",
  train: "🚄",
  road: "🚗",
  ferry: "⛴",
  hike: "🥾",
  bike: "🚴",
  other: "📌",
};

interface TimelineTabProps {
  trip: Trip;
  onChanged: () => void;
  t: ReturnType<typeof useTranslation>["t"];
  /** Drives the UTC date/time formatting of stop cards — see lib/tripTimeline.ts. */
  language: string | undefined;
}

function TimelineTab({ trip, onChanged, t, language }: TimelineTabProps): JSX.Element {
  const addToast = useToastStore((s) => s.addToast);
  // Both the user's domain choice and the instance beta flag, via the one
  // hook that combines them — see hooks/usePlacesVisible.ts.
  const poiEnabled = usePlacesVisible();
  const id = trip.id;
  /** Places visited on THIS trip, with the visit that ties them to it. A place
   *  is a first-class row of its own now, so the trip READS it rather than
   *  owning it — which is what #177 asked for. */
  const [placeVisits, setPlaceVisits] = useState<{ place: Place; visit: PlaceVisit }[]>([]);

  // Places are their own domain, so they are fetched separately rather than
  // embedded in the trip payload. A failure here must not blank the trip: the
  // timeline simply shows no places, which is what it did before they existed.
  useEffect(() => {
    if (!id || !poiEnabled) {
      setPlaceVisits([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const places = await listPlaces({ tripId: id });
        if (cancelled) return;
        setPlaceVisits(
          places.flatMap((place) =>
            place.visits.filter((v) => v.tripId === id).map((visit) => ({ place, visit }))
          )
        );
      } catch (err: unknown) {
        logger.error({ err }, "TripDetailPage: failed to load place visits");
        if (!cancelled) setPlaceVisits([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, poiEnabled]);

  const [adding, setAdding] = useState<null | "journal" | "stop">(null);
  const [editingJournal, setEditingJournal] = useState<TripJournalEntry | null>(null);
  const [viewingJournal, setViewingJournal] = useState<TripJournalEntry | null>(null);
  const [editingStop, setEditingStop] = useState<TripStop | null>(null);
  // Only a fallback: a flight whose airport record lacks an IANA zone.
  const userTz = useSettingsStore((s) => s.display?.timezone) || "UTC";

  const events = useMemo<TimelineEvent[]>(() => {
    const out: TimelineEvent[] = [];
    for (const f of trip.flights ?? []) {
      if (!f.departureTime) continue;
      out.push({
        id: `flight-${f.id}`,
        kind: "flight",
        date: f.departureTime,
        title: `${f.depIata ?? "???"} → ${f.arrIata ?? "???"}`,
        // Airport-local, not the viewer's clock. `toLocaleString()` rendered a
        // JFK arrival in Europe/Berlin, so the same flight read 13:45 in the
        // flights table and 19:45 here — six hours apart from the boarding
        // pass. Each end is formatted against its own airport's zone, with the
        // stored time semantics so a DATE_ONLY historical row keeps its date.
        subtitle: f.arrivalTime
          ? `${formatDateTimeInTimezone(f.departureTime, f.depTimezone || userTz, f.depTimeSemantics)} → ${formatDateTimeInTimezone(f.arrivalTime, f.arrTimezone || userTz, f.arrTimeSemantics)}`
          : formatDateTimeInTimezone(f.departureTime, f.depTimezone || userTz, f.depTimeSemantics),
        flight: f,
      });
    }
    for (const c of trip.cruises ?? []) {
      if (!c.startDate) continue;
      out.push({
        id: `cruise-${c.id}`,
        kind: "cruise",
        date: c.startDate,
        title: c.cruiseLine ?? "Kreuzfahrt",
        subtitle: c.endDate
          ? `${new Date(c.startDate).toLocaleDateString()} → ${new Date(c.endDate).toLocaleDateString()}`
          : new Date(c.startDate).toLocaleDateString(),
        cruise: c,
      });
    }
    for (const s of trip.stops ?? []) {
      // A migrated POI stop is drawn as its PlaceVisit instead. Both rows
      // exist between the backfill and the delete release, so without this
      // every migrated POI would appear twice — see isSupersededByPlaceVisit.
      if (isSupersededByPlaceVisit(s)) continue;
      out.push({
        id: `stop-${s.id}`,
        kind: "stop",
        date: s.startDate ?? s.createdAt,
        stop: s,
      });
    }
    for (const { place, visit } of placeVisits) {
      // An undated visit has no place on a chronology; it still shows on the
      // place itself. Same rule an undated lodging stay already follows.
      if (!visit.visitedAt) continue;
      out.push({
        id: `place-visit-${visit.id}`,
        kind: "place-visit",
        date: visit.visitedAt,
        place,
        visit,
      });
    }
    for (const e of trip.journalEntries ?? []) {
      out.push({
        id: `journal-${e.id}`,
        kind: "journal",
        date: e.date,
        entry: e,
      });
    }
    // Each linked stay renders as TWO timeline entries — a check-in and a
    // check-out — mirroring how TripStop entries already work, so the
    // hotel is actually visible in the trip's chronology instead of
    // disappearing once it's assigned (the spec gap this closes).
    for (const s of trip.lodgingStays ?? []) {
      // A timeline is ordered by date, so an undated stay has no place on one.
      // It is still shown on the trip — in the lodging list below, which needs
      // no chronology — rather than being dropped from the page.
      if (s.checkIn !== null) {
        out.push({
          id: `lodging-checkin-${s.id}`,
          kind: "lodging-checkin",
          date: s.checkIn,
          stay: s,
        });
      }
      if (s.checkOut !== null) {
        out.push({
          id: `lodging-checkout-${s.id}`,
          kind: "lodging-checkout",
          date: s.checkOut,
          stay: s,
        });
      }
    }
    // #175: ordered by time of day, with a day's diary entry last. See
    // compareTimelineEvents — the tie-break rules and the reason they exist
    // live there, not here.
    return out.sort(compareTimelineEvents);
  }, [trip, placeVisits]);

  // Cross-domain geo sanity (#6): a stay whose hotel sits far from every trip
  // leg is almost certainly an import/typo error. Compute the set of such stay
  // IDs once from this trip's flight arrivals and cruise ports; the timeline
  // entry shows a soft hint. Hotel-only trips have no legs and never warn.
  const implausibleStayIds = useMemo(() => {
    // Flight arrivals are the signal here; the trip's cruise shape does not
    // carry port coordinates, so a cruise-only trip has no legs and never
    // warns — safe, and it still catches the common "hotel far from where you
    // flew" case.
    const legs = (trip?.flights ?? []).map((f) => ({ lat: f.arrLat, lon: f.arrLon }));
    const flagged = new Set<string>();
    for (const s of trip?.lodgingStays ?? []) {
      const { plausible } = assessStayPlausibility(
        { lat: s.lodging.lat, lon: s.lodging.lon },
        legs
      );
      if (!plausible) flagged.add(s.id);
    }
    return flagged;
  }, [trip]);

  // Past/upcoming is shown on the rail (line + dots), not by graying out
  // entries — see #184. Recomputed per render; a page-lifetime "now" is fine.
  const railStates = useMemo(() => {
    return computeRailStates(
      events.map((ev) => ev.date),
      Date.now()
    );
  }, [events]);

  const empty = events.length === 0;

  const handleDeleteJournal = async (entry: TripJournalEntry): Promise<void> => {
    if (!window.confirm(t("trips:detail.timeline.deleteJournalConfirm"))) return;
    try {
      await tripsApi.deleteJournalEntry(trip.id, entry.id);
      addToast("success", t("trips:detail.timeline.deletedJournal"));
      onChanged();
    } catch {
      addToast("error", t("trips:toasts.deleteError"));
    }
  };

  const handleDeleteStop = async (stop: TripStop): Promise<void> => {
    if (!window.confirm(t("trips:detail.timeline.deleteStopConfirm", { title: stop.title }))) {
      return;
    }
    try {
      await tripsApi.deleteStop(trip.id, stop.id);
      addToast("success", t("trips:detail.timeline.deletedStop"));
      onChanged();
    } catch {
      addToast("error", t("trips:toasts.deleteError"));
    }
  };

  return (
    <>
      <div className="mb-4 flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setAdding("journal")}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:border-(--accent) hover:text-(--accent)"
          style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
        >
          {t("trips:detail.timeline.addJournal")}
        </button>
        <button
          type="button"
          onClick={() => setAdding("stop")}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:border-(--accent) hover:text-(--accent)"
          style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
        >
          {t("trips:detail.timeline.addStop")}
        </button>
      </div>

      {empty ? (
        <Placeholder text={t("trips:detail.timeline.noEvents")} />
      ) : (
        <ol className="relative pl-7" style={{ listStyle: "none", margin: 0 }}>
          {events.map((ev, i) => {
            const isFirst = i === 0;
            const isLast = i === events.length - 1;
            const rail = railStates[i];
            return (
              <li key={ev.id} className="relative" style={{ marginBottom: isLast ? 0 : 12 }}>
                {/*
                Connector line drawn as two half-segments per item so it runs
                exactly dot-to-dot with no stub above the first or below the
                last dot (regardless of card height). `bottom: -12` bridges the
                12px marginBottom gap to the next item's top edge.
              */}
                {!isFirst && (
                  <span
                    aria-hidden
                    data-testid="timeline-rail-top"
                    data-filled={rail.topFilled}
                    className="absolute"
                    style={{
                      left: -18,
                      top: 0,
                      bottom: "50%",
                      width: 2,
                      transform: "translateX(-50%)",
                      background: rail.topFilled ? "var(--accent)" : "var(--color-border)",
                    }}
                  />
                )}
                {!isLast && (
                  <span
                    aria-hidden
                    data-testid="timeline-rail-bottom"
                    data-filled={rail.bottomFilled}
                    className="absolute"
                    style={{
                      left: -18,
                      top: "50%",
                      bottom: -12,
                      width: 2,
                      transform: "translateX(-50%)",
                      background: rail.bottomFilled ? "var(--accent)" : "var(--color-border)",
                    }}
                  />
                )}
                {/*
                Dot: filled, vertically centered on the card (the li tightly
                wraps its card, so top:50% is the card's centre) and horizontally
                centered on the connector line. The base-coloured ring masks the
                line where it passes behind the dot. Past events keep their
                domain colour; upcoming ones stay neutral (#184).
              */}
                <span
                  aria-hidden
                  data-testid="timeline-rail-dot"
                  data-past={rail.dotPast}
                  className="absolute w-3 h-3 rounded-full"
                  style={{
                    left: -18,
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    background: rail.dotPast ? dotColor(ev) : "var(--color-border)",
                    boxShadow: "0 0 0 3px var(--bg-base)",
                  }}
                />
                {ev.kind === "flight" && <FlightCard ev={ev} language={language} t={t} />}
                {ev.kind === "cruise" && <CruiseCard ev={ev} language={language} t={t} />}
                {(ev.kind === "lodging-checkin" || ev.kind === "lodging-checkout") && (
                  <LodgingCheckCard
                    ev={ev}
                    t={t}
                    language={language}
                    implausible={implausibleStayIds.has(ev.stay.id)}
                  />
                )}
                {ev.kind === "stop" && (
                  <StopCard
                    ev={ev}
                    language={language}
                    onEdit={() => setEditingStop(ev.stop)}
                    onDelete={() => void handleDeleteStop(ev.stop)}
                  />
                )}
                {ev.kind === "place-visit" && <PlaceVisitCard ev={ev} language={language} />}
                {ev.kind === "journal" && (
                  <JournalCard
                    ev={ev}
                    language={language}
                    onView={() => setViewingJournal(ev.entry)}
                    onEdit={() => setEditingJournal(ev.entry)}
                    onDelete={() => void handleDeleteJournal(ev.entry)}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {(adding === "journal" || editingJournal) && (
        <JournalEntryModal
          tripId={trip.id}
          entry={editingJournal}
          defaultDate={trip.startDate ?? undefined}
          onClose={() => {
            setAdding(null);
            setEditingJournal(null);
          }}
          onSaved={() => {
            setAdding(null);
            setEditingJournal(null);
            onChanged();
          }}
        />
      )}
      {viewingJournal && (
        <JournalViewModal
          entry={viewingJournal}
          onClose={() => setViewingJournal(null)}
          onEdit={() => {
            setEditingJournal(viewingJournal);
            setViewingJournal(null);
          }}
        />
      )}
      {(adding === "stop" || editingStop) && (
        <StopModal
          tripId={trip.id}
          stop={editingStop}
          defaultDate={trip.startDate ?? undefined}
          onClose={() => {
            setAdding(null);
            setEditingStop(null);
          }}
          onSaved={() => {
            setAdding(null);
            setEditingStop(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function dotColor(ev: TimelineEvent): string {
  switch (ev.kind) {
    case "flight":
      return "var(--domain-flight, var(--accent))";
    case "cruise":
      return "var(--domain-cruise, #6fa0d6)";
    case "stop":
    case "place-visit":
      return "var(--domain-poi, #5ec2b2)";
    case "journal":
      return "#60a5fa";
    case "lodging-checkin":
    case "lodging-checkout":
      return "var(--domain-lodging, #d4778f)";
  }
}

function EventCard({
  icon,
  bg,
  iconColor,
  title,
  subtitle,
  meta,
  date,
  dateLabel,
  actions,
}: {
  icon: string;
  bg: string;
  iconColor: string;
  title: string;
  subtitle?: string | null;
  meta?: React.ReactNode;
  date: string;
  /**
   * Overrides the rendered date text. Stops pass a UTC-formatted label with
   * their time of day (#175) — their `date` is a WALL CLOCK, not an instant.
   * Everything else keeps `toLocaleDateString()`, deliberately: a flight's
   * `departureTime` IS a real instant, and forcing it to UTC here could show
   * the wrong calendar day for a departure near midnight local.
   */
  dateLabel?: string;
  actions?: React.ReactNode;
}): JSX.Element {
  return (
    <div
      className="rounded-xl px-4 py-3 flex items-start gap-3"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <span
        className="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0"
        style={{ background: bg, color: iconColor }}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">{title}</div>
        {subtitle && (
          <div className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
            {subtitle}
          </div>
        )}
        {meta && (
          <div
            className="text-xs mt-1.5 leading-relaxed"
            style={{ color: "var(--text-primary)", opacity: 0.85 }}
          >
            {meta}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0 text-right">
        <time
          className="text-[11px] font-mono"
          style={{ color: "var(--text-muted)" }}
          dateTime={date}
        >
          {dateLabel ?? new Date(date).toLocaleDateString()}
        </time>
        {actions}
      </div>
    </div>
  );
}

/**
 * The clock time of a cruise stop.
 *
 * A stop's arrival/departure is a UTC-pinned WALL CLOCK, like the stop's date
 * itself — the ship's local time, stored at UTC so it cannot drift. Rendering
 * it in the viewer's zone would move Barcelona's 12:00 departure by an hour for
 * a reader in London. The raw value is a full ISO timestamp, which is what
 * reached the screen before this existed.
 */
/**
 * The four cabin types the schema names. Anything else is shown as stored.
 *
 * `Cruise.cabinType` is TYPED as an enum and is not one in practice: measured
 * on 2026-08-29, the demo seed alone holds thirteen distinct free-text values
 * ("Balkonkabine", "The Haven Penthouse", "Yacht Club Suite"), and a parsed
 * booking can carry whatever the line calls its cabins. Translating blindly put
 * the raw key "cabinType.Balkon" on screen. A word we do not have a translation
 * for is still a word the user recognises — printing it beats printing a key.
 */
const CABIN_TYPES = ["inside", "oceanview", "balcony", "suite"] as const;

export function cabinLabel(
  value: string | null | undefined,
  t: ReturnType<typeof useTranslation>["t"]
): string | null {
  if (!value) return null;
  return (CABIN_TYPES as readonly string[]).includes(value)
    ? t(`cruise:cabinType.${value}`)
    : value;
}

function stopClock(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(11, 16);
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): JSX.Element | null {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex gap-2 text-xs py-0.5">
      <span style={{ color: "var(--text-muted)", minWidth: 110 }}>{label}</span>
      <span style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

/** The link out of the panel. Always a sibling of the toggle button, never a
 *  child of it — see the note in ExpandableEventCard. */
function OpenFullLink({ to, label }: { to: string; label: string }): JSX.Element {
  return (
    <Link
      to={to}
      className="inline-block mt-2 rounded-lg px-3 py-1.5 text-xs font-medium"
      style={{ border: "1px solid var(--accent)", color: "var(--accent)" }}
    >
      {label} →
    </Link>
  );
}

function FlightCard({
  ev,
  language,
  t,
}: {
  ev: Extract<TimelineEvent, { kind: "flight" }>;
  language: string | undefined;
  t: ReturnType<typeof useTranslation>["t"];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const f = ev.flight;
  const seat = [f.seatNumber, f.seatClass ? t(`flights:seatClass.${f.seatClass}`) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <ExpandableEventCard
      icon="✈"
      bg="rgba(240,169,71,0.15)"
      iconColor="var(--domain-flight, var(--accent))"
      title={ev.title}
      subtitle={ev.subtitle}
      date={ev.date}
      expanded={open}
      onToggle={() => setOpen((v) => !v)}
      detailsLabel={t("trips:detail.timeline.showDetails")}
    >
      <DetailRow
        label={t("trips:detail.timeline.flightNumber")}
        value={[f.airline, f.flightNumber].filter(Boolean).join(" ") || null}
      />
      <DetailRow label={t("trips:detail.timeline.aircraft")} value={f.aircraft ?? null} />
      <DetailRow label={t("trips:detail.timeline.seat")} value={seat || null} />
      <DetailRow
        label={t("trips:detail.timeline.price")}
        value={f.price != null ? formatAmount(f.price, f.currency, { language }) : null}
      />
      <OpenFullLink to={`/flights/${f.id}`} label={t("trips:detail.timeline.openFlight")} />
    </ExpandableEventCard>
  );
}

function CruiseCard({
  ev,
  language,
  t,
}: {
  ev: Extract<TimelineEvent, { kind: "cruise" }>;
  language: string | undefined;
  t: ReturnType<typeof useTranslation>["t"];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const c = ev.cruise;
  const ship = c.ship?.name ?? c.shipNameOverride ?? null;
  const stops = c.stops ?? [];
  return (
    <ExpandableEventCard
      icon="⚓"
      bg="rgba(111,160,214,0.15)"
      iconColor="var(--domain-cruise, #6fa0d6)"
      title={ev.title}
      subtitle={ev.subtitle}
      date={ev.date}
      // A cruise start date is a UTC-pinned calendar day, like a stop and a
      // diary entry — same formatting, so one timeline never shows two date
      // styles side by side. Only FlightCard keeps local formatting, because
      // a departure time is a genuine instant.
      dateLabel={formatTimelineDate(ev.date, language)}
      expanded={open}
      onToggle={() => setOpen((v) => !v)}
      detailsLabel={t("trips:detail.timeline.showDetails")}
    >
      <DetailRow label={t("trips:detail.timeline.ship")} value={ship} />
      <DetailRow label={t("trips:detail.timeline.route")} value={c.routeName ?? null} />
      <DetailRow
        label={t("trips:detail.timeline.cabin")}
        value={[cabinLabel(c.cabinType, t), c.cabinNumber].filter(Boolean).join(" · ") || null}
      />
      <DetailRow
        label={t("trips:detail.timeline.price")}
        value={c.price != null ? formatAmount(c.price, c.currency, { language }) : null}
      />

      {stops.length > 0 && (
        <div className="mt-2">
          <div
            className="text-[11px] uppercase tracking-wide mb-1"
            style={{ color: "var(--text-muted)" }}
          >
            {t("trips:detail.timeline.itinerary")}
          </div>
          <ol className="flex flex-col gap-0.5" style={{ listStyle: "none", paddingLeft: 0 }}>
            {stops.map((stop) => (
              <li key={stop.id} className="flex gap-2 text-xs">
                <span
                  className="font-mono shrink-0"
                  style={{ color: "var(--text-muted)", minWidth: 22 }}
                >
                  {stop.dayNumber}
                </span>
                <span style={{ color: "var(--text-primary)" }}>
                  {/* The three-state stop invariant, rendered honestly: a sea
                      day says so, an unresolved port keeps the name it was
                      imported under rather than pretending to be a catalogue
                      port, and a matched port shows its own name. */}
                  {stop.isAtSea
                    ? t("trips:detail.timeline.atSea")
                    : (stop.port?.name ?? stop.unresolvedPortName ?? "—")}
                </span>
                {(stop.arrivalTime || stop.departureTime) && (
                  <span className="font-mono ml-auto" style={{ color: "var(--text-muted)" }}>
                    {[stopClock(stop.arrivalTime), stopClock(stop.departureTime)]
                      .filter(Boolean)
                      .join(" – ")}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <OpenFullLink to={`/cruises/${c.id}`} label={t("trips:detail.timeline.openCruise")} />
    </ExpandableEventCard>
  );
}

/**
 * Renders one half (check-in OR check-out) of a linked LodgingStay as a
 * timeline entry. Uses the lodging domain colour (`DOMAINS.lodging.color`,
 * `#d4778f` via the `--domain-lodging` CSS var) and the hotel icon, and
 * clicking it navigates to that hotel's own detail page — the whole point
 * being that a hotel linked to a trip is no longer a dead end.
 */
function LodgingCheckCard({
  ev,
  t,
  language,
  implausible = false,
}: {
  ev: Extract<TimelineEvent, { kind: "lodging-checkin" | "lodging-checkout" }>;
  t: ReturnType<typeof useTranslation>["t"];
  language: string | undefined;
  /** #6: hotel sits far from every trip leg — shown on the check-in entry. */
  implausible?: boolean;
}): JSX.Element {
  const { stay } = ev;
  const isCheckIn = ev.kind === "lodging-checkin";
  const title = t(
    isCheckIn ? "trips:detail.timeline.lodgingCheckIn" : "trips:detail.timeline.lodgingCheckOut",
    { name: stay.lodging.name }
  );
  // Check-in/out are stored as the calendar day at UTC midnight and we capture no
  // time of day. Rendering them in local time would print a meaningless "02:00" and,
  // west of UTC, shift the day backwards.
  const subtitle = formatDateInTimezone(ev.date, "UTC");
  // Only on the check-in entry, so the hint appears once per stay, not twice.
  const showHint = implausible && isCheckIn;
  return (
    <Link to={`/lodging/${stay.lodgingId}`} className="block">
      <EventCard
        icon="🏨"
        bg="rgba(212,119,143,0.15)"
        iconColor="var(--domain-lodging, #d4778f)"
        title={title}
        subtitle={
          showHint ? `${subtitle} · ⚠︎ ${t("trips:detail.timeline.lodgingFarFromTrip")}` : subtitle
        }
        date={ev.date}
        dateLabel={formatTimelineDate(ev.date, language)}
      />
    </Link>
  );
}

function StopCard({
  ev,
  language,
  onEdit,
  onDelete,
}: {
  ev: Extract<TimelineEvent, { kind: "stop" }>;
  language: string | undefined;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const s = ev.stop;
  const icon = STOP_DOMAIN_ICON[s.domain ?? "other"] ?? "📍";
  const subtitle =
    s.lat != null && s.lon != null
      ? `${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}`
      : (s.description ?? null);
  return (
    <EventCard
      icon={icon}
      bg="rgba(94,194,178,0.15)"
      iconColor="var(--domain-poi, #5ec2b2)"
      title={s.title}
      subtitle={subtitle}
      meta={s.notes ?? undefined}
      date={ev.date}
      dateLabel={formatTimelineDate(ev.date, language)}
      actions={<RowActions onEdit={onEdit} onDelete={onDelete} />}
    />
  );
}

/**
 * A place visited on this trip. Deliberately has no edit/delete actions: the
 * place is not owned by the trip, so deleting it here would be deleting it
 * from every other trip and from the globe. Editing happens on the place.
 */
function PlaceVisitCard({
  ev,
  language,
}: {
  ev: Extract<TimelineEvent, { kind: "place-visit" }>;
  language: string | undefined;
}): JSX.Element {
  const { place, visit } = ev;
  const where = [place.city, place.country].filter(Boolean).join(", ");
  return (
    <EventCard
      icon={PLACE_CATEGORY_ICONS[place.category] ?? PLACE_CATEGORY_ICONS.other}
      bg="rgba(94,194,178,0.15)"
      iconColor="var(--domain-poi, #5ec2b2)"
      title={place.name}
      subtitle={where || null}
      meta={visit.notes ?? undefined}
      date={ev.date}
      // A visit time is a WALL CLOCK at the place, exactly like a stop's —
      // formatted in UTC for the reason lib/tripTimeline.ts documents at
      // length. Using toLocaleString here would shift #175's ordering off by
      // the reader's offset.
      dateLabel={formatTimelineDate(ev.date, language)}
    />
  );
}

function JournalCard({
  ev,
  language,
  onView,
  onEdit,
  onDelete,
}: {
  ev: Extract<TimelineEvent, { kind: "journal" }>;
  language: string | undefined;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const e = ev.entry;
  // The headline is a single short line, so Markdown is stripped rather than
  // rendered there; the body below it renders (issue #231).
  const headline = e.title ?? truncate(stripMarkdown(e.body), 50);
  const meta = [e.weather, e.mood].filter(Boolean).join(" · ") || undefined;
  return (
    <EventCard
      icon="📝"
      bg="rgba(96,165,250,0.15)"
      iconColor="#60a5fa"
      title={headline}
      subtitle={meta ?? null}
      meta={e.title ? <JournalPreview body={e.body} /> : undefined}
      date={ev.date}
      dateLabel={formatTimelineDate(ev.date, language)}
      actions={<RowActions onView={onView} onEdit={onEdit} onDelete={onDelete} />}
    />
  );
}

function RowActions({
  onView,
  onEdit,
  onDelete,
}: {
  onView?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const { t } = useTranslation(["common"]);
  return (
    <div className="flex gap-1 mt-1">
      {onView && (
        <button
          type="button"
          onClick={onView}
          className="text-[11px] px-1.5 py-0.5 rounded-sm"
          style={{ color: "var(--text-muted)" }}
          aria-label={t("common:accessibility.view")}
          title="view"
        >
          👁
        </button>
      )}
      <button
        type="button"
        onClick={onEdit}
        className="text-[11px] px-1.5 py-0.5 rounded-sm"
        style={{ color: "var(--text-muted)" }}
        aria-label={t("common:buttons.edit")}
        title="edit"
      >
        ✎
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="text-[11px] px-1.5 py-0.5 rounded-sm"
        style={{ color: "var(--danger, #f87171)" }}
        aria-label={t("common:buttons.delete")}
        title="delete"
      >
        ✕
      </button>
    </div>
  );
}

function truncate(text: string, n: number): string {
  if (text.length <= n) return text;
  return text.slice(0, n - 1).trimEnd() + "…";
}

/* ─────────── Tab: Logistics ─────────── */

function LogisticsTab({
  trip,
  t,
  language,
  onChanged,
}: {
  trip: Trip;
  t: ReturnType<typeof useTranslation>["t"];
  language: string | undefined;
  onChanged: () => void;
}): JSX.Element {
  const flights = trip.flights ?? [];
  const cruises = trip.cruises ?? [];
  const bookings = trip.bookings ?? [];
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);

  const costTotals = sumByCurrency(bookings);

  if (flights.length === 0 && cruises.length === 0 && bookings.length === 0) {
    return <Placeholder text={t("trips:detail.noLinks")} />;
  }

  return (
    <div className="space-y-4">
      {flights.length > 0 && (
        <div
          className="rounded-xl"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <PanelHeader>
            {t("trips:detail.logistics.flights")} ({flights.length})
          </PanelHeader>
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-xs uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                <th className="text-left px-4 py-2">Datum</th>
                <th className="text-left px-4 py-2">Route</th>
                <th className="text-right px-4 py-2">↗</th>
              </tr>
            </thead>
            <tbody>
              {flights.map((f) => (
                <tr key={f.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td
                    className="px-4 py-2.5 whitespace-nowrap"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {f.departureTime ? new Date(f.departureTime).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2.5 font-mono">
                    {f.depIata ?? "???"} → {f.arrIata ?? "???"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link to="/flights" className="text-xs" style={{ color: "var(--accent)" }}>
                      öffnen
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cruises.length > 0 && (
        <div
          className="rounded-xl"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <PanelHeader>
            {t("trips:detail.logistics.cruises")} ({cruises.length})
          </PanelHeader>
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-xs uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                <th className="text-left px-4 py-2">Datum</th>
                <th className="text-left px-4 py-2">Reederei</th>
                <th className="text-right px-4 py-2">↗</th>
              </tr>
            </thead>
            <tbody>
              {cruises.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td
                    className="px-4 py-2.5 whitespace-nowrap"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {c.startDate ? new Date(c.startDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2.5">{c.cruiseLine ?? "Kreuzfahrt"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      to={`/cruises/${c.id}`}
                      className="text-xs"
                      style={{ color: "var(--accent)" }}
                    >
                      öffnen
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bookings.length > 0 && (
        <div
          className="rounded-xl"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <PanelHeader>
            {t("trips:detail.logistics.bookings")} ({bookings.length})
            {costTotals.length > 0 && (
              <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                · {t("trips:detail.logistics.totalBooked")}:{" "}
                <strong style={{ color: "var(--text-primary)" }}>
                  {costTotals
                    .map((c) => formatCurrency(c.total, c.currency, { compact: true, language }))
                    .join(" + ")}
                </strong>
              </span>
            )}
          </PanelHeader>
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-xs uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                <th className="text-left px-4 py-2">PNR</th>
                <th className="text-right px-4 py-2">Preis</th>
                <th className="text-right px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td className="px-4 py-2.5 font-mono">{b.pnr ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    {b.price != null ? formatAmount(b.price, b.currency, { language }) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => setEditingBooking(b)}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-sm hover:bg-(--bg-muted) hover:text-[#388bfd]"
                      style={{ color: "var(--text-muted)" }}
                      aria-label={t("trips:bookingEdit.title")}
                      title={t("trips:bookingEdit.title")}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingBooking && (
        <BookingEditModal
          booking={editingBooking}
          onClose={() => setEditingBooking(null)}
          onSaved={() => {
            setEditingBooking(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/* ─────────── Shared bits ─────────── */

function TripStatsRow({
  trip,
  t,
  language,
}: {
  trip: Trip;
  t: ReturnType<typeof useTranslation>["t"];
  language: string | undefined;
}): JSX.Element {
  // Domain-gating: the cruise/lodging tile disappears entirely when that
  // domain is disabled (a "0" tile would still advertise the domain).
  const { isEnabled } = useEnabledDomains();
  const cruiseEnabled = isEnabled("cruise");
  const lodgingEnabled = isEnabled("lodging");
  const flightCount = trip._count?.flights ?? trip.flights?.length ?? 0;
  const cruiseCount = trip._count?.cruises ?? trip.cruises?.length ?? 0;
  const lodgingCount = trip._count?.lodgingStays ?? trip.lodgingStays?.length ?? 0;
  // Cruises and lodging stays count towards the total exactly as flights do —
  // but only while their domain is on, matching the tiles above.
  const costTotals = sumByCurrency(
    tripCostSources(
      trip.bookings ?? [],
      trip.flights ?? [],
      cruiseEnabled ? (trip.cruises ?? []) : [],
      lodgingEnabled ? (trip.lodgingStays ?? []) : []
    )
  );

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <StatTile value={flightCount} label={t("trips:detail.stats.flights")} />
      {cruiseEnabled && <StatTile value={cruiseCount} label={t("trips:detail.stats.cruises")} />}
      {lodgingEnabled && <StatTile value={lodgingCount} label={t("trips:detail.stats.lodging")} />}
      <StatTile value={trip.countries.length} label={t("trips:detail.stats.countries")} />
      <StatTile value={trip.companions.length} label={t("trips:detail.stats.companions")} />
      {/* Through `formatCurrency`, like the trip card: the tile wrote
          "EUR 40206" while the card beside it wrote "40.206 €" (forgejo#86). */}
      <StatTile
        value={
          costTotals.length > 0
            ? costTotals
                .map((c) => formatCurrency(c.total, c.currency, { compact: true, language }))
                .join(" + ")
            : "—"
        }
        label={t("trips:totalCost")}
      />
      <StatTile value={trip.tags.length} label={t("trips:detail.stats.tags")} />
    </div>
  );
}

function StatTile({ value, label }: { value: string | number; label: string }): JSX.Element {
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <div className="text-xl font-display font-bold">{value}</div>
      <div
        className="text-[10px] uppercase tracking-wide mt-0.5"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
    </div>
  );
}

function NotesPanel({
  notes,
  t,
}: {
  notes: string;
  t: ReturnType<typeof useTranslation>["t"];
}): JSX.Element {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <div
        className="text-[10px] uppercase tracking-wide mb-2"
        style={{ color: "var(--text-muted)" }}
      >
        {t("trips:detail.notes")}
      </div>
      <div className="text-sm whitespace-pre-wrap leading-relaxed">{notes}</div>
    </div>
  );
}

function SidePanel({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <div
        className="text-[10px] uppercase tracking-wide mb-2"
        style={{ color: "var(--text-muted)" }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function PanelHeader({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="px-4 py-2.5 text-xs uppercase tracking-wide"
      style={{
        color: "var(--text-muted)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {children}
    </div>
  );
}

function Placeholder({ text }: { text: string }): JSX.Element {
  return (
    <div
      className="rounded-xl p-12 text-center text-sm"
      style={{
        background: "var(--bg-surface)",
        border: "1px dashed var(--color-border)",
        color: "var(--text-muted)",
      }}
    >
      {text}
    </div>
  );
}
