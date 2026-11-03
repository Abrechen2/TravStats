import { useVisibleTrip } from "../hooks/useVisibleTrip";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { tripsApi } from "../lib/api";
import { formatLocalDate, formatTimeValueShown } from "../lib/displayFormat";
import { cruiseStart, flightDeparture, tripStart } from "../lib/entityTimes";
import { logger } from "../lib/logger";
import { EDIT_PARAM, useEditDeepLink } from "../lib/editDeepLink";
import { implausibleStayIds } from "../lib/tripStayPlausibility";
import { computeRailStates } from "../lib/timelineRail";
import { buildTimelineEvents, type TimelineEvent } from "../lib/tripTimelineEvents";
import { JournalCard } from "../components/Trips/TimelineJournalCard";
import { useToastStore } from "../store/toastStore";
import { usePlacesVisible } from "../hooks/usePlacesVisible";
import { useTranslation } from "../hooks/useTranslation";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import type { Trip, TripJournalEntry, TripStop } from "../types";
import TripDeleteConfirm from "../components/Trips/TripDeleteConfirm";
import AppShell from "../components/ui/AppShell";
import TripModal from "../components/Trips/TripModal";
import { TravelPlanSummary } from "../components/Trips/TravelPlanSummary";
import TripPackingCard from "../components/Trips/TripPackingCard";
import TripHead from "../components/Trips/TripHead";
import TripOverview from "../components/Trips/TripOverview";
import JournalEntryModal from "../components/Trips/JournalEntryModal";
import TimelineActions from "../components/Trips/TimelineActions";
import JournalViewModal from "../components/Trips/JournalViewModal";
import StopModal from "../components/Trips/StopModal";
import { TripBookingsPanel } from "../components/Trips/TripBookingsPanel";
import TripMapWithTours from "../components/Trips/TripMapWithTours";
import TripGallery from "../components/Trips/TripGallery";
import TourSectionList from "../components/Trips/TourSectionList";
import { useToursVisible } from "../hooks/useToursVisible";
import { PanelHeader, Placeholder } from "../components/Trips/TripDetailPanels";
import { TripGroundLists, groundRideCount } from "../components/Trips/TripGroundLists";
import { RentalBand, TransitCard, useRentalBands } from "../components/Trips/timelineTransit";
import { useTripPlaceVisits } from "../hooks/useTripPlaceVisits";
import { useTripNotes } from "../hooks/useTripNotes";
import { TimelineNoteCard, TripNotesNotice } from "../components/Trips/TimelineNoteCard";
import NoteEditorDialog from "../components/notes/NoteEditorDialog";
import type { Note } from "../lib/api/notes";
import {
  CruiseCard,
  FlightCard,
  LodgingCheckCard,
  PlaceVisitCard,
  StopCard,
  dotColor,
} from "../components/Trips/TimelineEventCards";

// Re-exported so the cabin-label tests keep importing it from the page.
export { cabinLabel } from "../components/Trips/TimelineEventCards";

type TabKey = "overview" | "timeline" | "map" | "gallery" | "logistics" | "tours";
const TABS: TabKey[] = ["overview", "timeline", "map", "gallery", "logistics", "tours"];

/**
 * Trip detail page with five tabs (Phase-1 iteration 2).
 *
 * - **Overview**: hero context (notes preview, latest items, side panels for
 *   companions / tags / countries).
 * - **Timeline**: chronological mix of flights and cruises rendered as one
 *   multi-domain event list.
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
  /* The open tab lives in the URL, not in component state alone: a link back
     from the tour editor (`/trips/:id?tab=tours`) has to land on the tab the
     user left, and a browser Back has to as well. An unknown value falls back
     to the overview rather than rendering nothing. */
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: TabKey = TABS.includes(tabParam as TabKey) ? (tabParam as TabKey) : "overview";
  const setTab = (next: TabKey): void => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "overview") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true }
    );
  };
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { displayTrip, hiddenCruiseCount, hiddenLodgingCount } = useVisibleTrip(trip);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load follows the trip id; it only calls stable setters and navigate
  }, [id]);
  // `?edit=1` — the inbox asking for the trip's own days (timeFlagLinks.ts).
  useEditDeepLink(EDIT_PARAM.edit, trip !== null, () => setEditing(true));

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
      <AppShell width="list">
        <div className="flex items-center justify-center py-20 text-(--text-muted)">
          {t("common:loading.default")}
        </div>
      </AppShell>
    );
  }

  const shownTrip = displayTrip ?? trip;

  return (
    <AppShell width="list">
      <TravelPlanSummary tripId={trip.id} />
      <TripHead
        trip={shownTrip}
        locale={i18n.language}
        t={t}
        onEdit={() => setEditing(true)}
        onDelete={() => setConfirmDelete(true)}
        onChanged={() => void load()}
      />
      <TripPackingCard tripId={trip.id} endDate={trip.endDate} />
      <TabBar tab={tab} onChange={setTab} t={t} />

      <div className="py-6">
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
          <TripOverview
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
        {tab === "map" && <TripMapWithTours trip={shownTrip} />}
        {tab === "gallery" && (
          <TripGallery
            tripId={shownTrip.id}
            photos={shownTrip.photos ?? []}
            photoCount={shownTrip.photoCount}
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

      {/* Extracted (components/Trips/TripDeleteConfirm.tsx) because the
          sentence now needs the document COUNT, and this file is frozen at its
          current length by the size ratchet. */}
      <TripDeleteConfirm
        isOpen={confirmDelete}
        tripId={trip.id}
        tripName={trip.name}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
      />
    </AppShell>
  );
}

interface TabBarProps {
  tab: TabKey;
  onChange: (tab: TabKey) => void;
  t: ReturnType<typeof useTranslation>["t"];
}

/** Exported for its own test: the "tours" tab kept a hard-coded "Beta" pill after its gate
 *  came off (auditor 3, 2026-09-19); a badge no registry entry backs, nothing can take away. */
export function TabBar({ tab, onChange, t }: TabBarProps): JSX.Element {
  // "tours" is behind the roadtrips beta key again since 2026-09-24 (owner).
  const toursVisible = useToursVisible();
  const visibleTabs = TABS.filter((key) => key !== "tours" || toursVisible);

  // Round 4: text tabs with the accent underline, like the logbook's; no emoji.
  return (
    <div
      role="tablist"
      className="flex overflow-x-auto overflow-y-hidden scrollbar-none"
      style={{ borderBottom: "1px solid var(--ts-border)" }}
    >
      {visibleTabs.map((key) => {
        const isActive = tab === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(key)}
            className="flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-3 text-sm"
            style={{
              fontWeight: isActive ? 700 : 500,
              color: isActive ? "var(--ts-text-bright)" : "var(--ts-muted)",
              boxShadow: `inset 0 -2px 0 ${isActive ? "var(--ts-accent)" : "transparent"}`,
            }}
          >
            {t(`trips:detail.tabs.${key}`)}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────── Tab: Timeline ─────────── */

interface TimelineTabProps {
  trip: Trip;
  onChanged: () => void;
  t: ReturnType<typeof useTranslation>["t"];
  /** The UI language, for the cards that format amounts. */
  language: string | undefined;
}

function TimelineTab({ trip, onChanged, t, language }: TimelineTabProps): JSX.Element {
  const addToast = useToastStore((s) => s.addToast);
  const { confirmDelete, confirmDialog } = useConfirmDialog();
  // The user's domain choice and the instance beta flag, combined in hooks/usePlacesVisible.ts.
  const poiEnabled = usePlacesVisible();
  const placeVisits = useTripPlaceVisits(trip.id, poiEnabled);
  const tripNotes = useTripNotes(trip.id);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  const [adding, setAdding] = useState<null | "journal" | "stop">(null);
  const [editingJournal, setEditingJournal] = useState<TripJournalEntry | null>(null);
  const [viewingJournal, setViewingJournal] = useState<TripJournalEntry | null>(null);
  const [editingStop, setEditingStop] = useState<TripStop | null>(null);
  // `?editStop=` / `?editJournal=` — the inbox asking for a stop's or an
  // entry's zone, time or day (timeFlagLinks.ts).
  useEditDeepLink(EDIT_PARAM.editStop, true, (stopId) => {
    const stop = trip.stops?.find((s) => s.id === stopId);
    if (stop) setEditingStop(stop);
    else addToast("error", t("trips:detail.stopNotFound"));
  });
  useEditDeepLink(EDIT_PARAM.editJournal, true, (entryId) => {
    const entry = trip.journalEntries?.find((j) => j.id === entryId);
    if (entry) setEditingJournal(entry);
    else addToast("error", t("trips:detail.journalEntryNotFound"));
  });
  const events = useMemo<TimelineEvent[]>(
    () => buildTimelineEvents(trip, placeVisits, tripNotes.notes),
    [trip, placeVisits, tripNotes.notes]
  );

  // Cross-domain geo sanity (#6): a stay far from every place the trip reaches
  // is likely an import/typo error; the timeline entry shows a soft hint.
  const implausibleStays = useMemo(() => implausibleStayIds(trip), [trip]);

  const rentalBands = useRentalBands(events);
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
    if (!(await confirmDelete(t("trips:detail.timeline.deleteJournalConfirm")))) return;
    try {
      await tripsApi.deleteJournalEntry(trip.id, entry.id);
      addToast("success", t("trips:detail.timeline.deletedJournal"));
      onChanged();
    } catch {
      addToast("error", t("trips:toasts.deleteError"));
    }
  };

  const handleDeleteStop = async (stop: TripStop): Promise<void> => {
    const question = t("trips:detail.timeline.deleteStopConfirm", { title: stop.title });
    if (!(await confirmDelete(question))) return;
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
      <TimelineActions
        tripId={trip.id}
        entries={trip.journalEntries ?? []}
        onAddJournal={() => setAdding("journal")}
        onChanged={onChanged}
      />
      <TripNotesNotice
        failed={tripNotes.failed}
        truncated={tripNotes.notes?.truncated ?? false}
        onRetry={tripNotes.reload}
      />

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
                <RentalBand segments={rentalBands[i]} />
                <TransitCard ev={ev} />
                {(ev.kind === "lodging-checkin" || ev.kind === "lodging-checkout") && (
                  <LodgingCheckCard ev={ev} t={t} implausible={implausibleStays.has(ev.stay.id)} />
                )}
                {ev.kind === "stop" && (
                  <StopCard
                    ev={ev}
                    onEdit={() => setEditingStop(ev.stop)}
                    onDelete={() => void handleDeleteStop(ev.stop)}
                  />
                )}
                {ev.kind === "place-visit" && <PlaceVisitCard ev={ev} />}
                {ev.kind === "note" && (
                  <TimelineNoteCard ev={ev} onEdit={() => ev.mine && setEditingNote(ev.note)} />
                )}
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
          trip={trip}
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
          defaultDate={tripStart(trip)?.date}
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
      {editingNote && (
        <NoteEditorDialog
          note={editingNote}
          onClose={() => setEditingNote(null)}
          onSaved={tripNotes.reload}
        />
      )}
      {confirmDialog}
    </>
  );
}

/** The logistics table's day for a flight: its departure airport's, not the reader's. */
function formatFlightDay(f: Parameters<typeof flightDeparture>[0]): string {
  const dep = flightDeparture(f);
  return dep ? formatTimeValueShown(dep, { dateOnly: true }) : "—";
}

function formatCruiseDay(c: Parameters<typeof cruiseStart>[0]): string {
  const start = cruiseStart(c);
  return start ? formatLocalDate(start.date) : "—";
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
  // The bookings panel stays reachable on an empty trip: a package booking
  // can be created by hand before anything else is on it (#356).
  const empty = !flights.length && !cruises.length && !groundRideCount(trip);

  return (
    <div className="space-y-4">
      {empty && (trip.bookings ?? []).length === 0 && (
        <Placeholder text={t("trips:detail.noLogistics")} />
      )}
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
                    {formatFlightDay(f)}
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
                    {formatCruiseDay(c)}
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

      <TripGroundLists trip={trip} />

      <TripBookingsPanel
        trip={trip}
        language={language}
        onChanged={onChanged}
        flightDay={formatFlightDay}
        cruiseDay={formatCruiseDay}
      />
    </div>
  );
}

/* ─────────── Shared bits ─────────── */
