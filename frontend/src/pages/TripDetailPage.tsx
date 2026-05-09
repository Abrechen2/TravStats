import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { differenceInCalendarDays } from "date-fns";
import { tripsApi } from "../lib/api";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import { useTranslation } from "../hooks/useTranslation";
import type { Trip, TripStatus } from "../types";
import PageTransition from "../components/PageTransition";
import TripModal from "../components/Trips/TripModal";

/**
 * Trip detail skeleton (Phase-1, iteration 1). Renders hero + stats +
 * linked-items list using the new schema fields. Tabs (Timeline / Map /
 * Gallery) come in iteration 2 once `TripStop` and `TripJournalEntry`
 * tables exist.
 */
export default function TripDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation(["trips", "common"]);
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = async (): Promise<void> => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await tripsApi.getById(id);
      setTrip(data);
    } catch (err) {
      logger.warn("Failed to load trip", err);
      addToast("error", t("trips:toasts.loadError", { defaultValue: "Reise nicht gefunden" }));
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
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--bg-base)", color: "var(--text-muted)" }}
      >
        {t("common:loading", { defaultValue: "Lädt …" })}
      </div>
    );
  }

  return (
    <PageTransition>
      <div
        className="min-h-screen"
        style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
      >
        <TripHero
          trip={trip}
          locale={i18n.language}
          t={t}
          onEdit={() => setEditing(true)}
          onDelete={() => setConfirmDelete(true)}
        />

        <div className="max-w-7xl mx-auto px-4 py-6">
          <TripStatsRow trip={trip} t={t} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
            <div className="lg:col-span-2 space-y-4">
              {trip.notes && <NotesPanel notes={trip.notes} t={t} />}
              <LinkedItemsPanel trip={trip} t={t} />
            </div>
            <div className="space-y-4">
              {trip.companions.length > 0 && (
                <SidePanel title={t("trips:detail.companions", { defaultValue: "Reisende" })}>
                  <div className="flex flex-wrap gap-2">
                    {trip.companions.map((name) => (
                      <span
                        key={name}
                        className="px-2 py-1 rounded-full text-xs"
                        style={{ background: "var(--bg-muted)", color: "var(--text-primary)" }}
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </SidePanel>
              )}
              {trip.tags.length > 0 && (
                <SidePanel title={t("trips:detail.tags", { defaultValue: "Tags" })}>
                  <div className="flex flex-wrap gap-1">
                    {trip.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded text-xs"
                        style={{ background: "var(--bg-muted)", color: "var(--text-muted)" }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </SidePanel>
              )}
              {trip.countries.length > 0 && (
                <SidePanel title={t("trips:detail.countries", { defaultValue: "Länder" })}>
                  <div className="flex flex-wrap gap-1 font-mono text-xs">
                    {trip.countries.map((cc) => (
                      <span
                        key={cc}
                        className="px-2 py-0.5 rounded"
                        style={{ background: "var(--bg-muted)", color: "var(--text-muted)" }}
                      >
                        {cc}
                      </span>
                    ))}
                  </div>
                </SidePanel>
              )}
            </div>
          </div>
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

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
        >
          <div
            className="w-full max-w-sm rounded-xl shadow-2xl p-6 space-y-4"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="text-base font-semibold">
              {t("trips:deleteTripConfirm", { name: trip.name })}
            </h2>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ color: "var(--text-muted)" }}
              >
                {t("trips:modal.cancel")}
              </button>
              <button
                onClick={() => void handleDelete()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: "var(--danger, #f87171)" }}
              >
                {t("trips:deleteTrip")}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageTransition>
  );
}

const STATUS_PILL_CLASS: Record<TripStatus, { bg: string; color: string }> = {
  planned: { bg: "rgba(96,165,250,0.18)", color: "#93c5fd" },
  in_progress: { bg: "rgba(240,169,71,0.22)", color: "#f0a947" },
  completed: { bg: "rgba(74,222,128,0.16)", color: "#86efac" },
};

interface TripHeroProps {
  trip: Trip;
  locale: string;
  t: ReturnType<typeof useTranslation>["t"];
  onEdit: () => void;
  onDelete: () => void;
}

function TripHero({ trip, locale, t, onEdit, onDelete }: TripHeroProps): JSX.Element {
  const start = trip.startDate ? new Date(trip.startDate) : null;
  const end = trip.endDate ? new Date(trip.endDate) : null;
  const dateRange = formatDateRange(start, end, locale);
  const nights = start && end ? Math.max(0, differenceInCalendarDays(end, start)) : null;

  const heroBg = trip.coverImageUrl
    ? `url(${trip.coverImageUrl})`
    : `linear-gradient(135deg, ${trip.color}, ${trip.color}40 60%, var(--bg-base))`;

  return (
    <div
      className="relative"
      style={{
        height: 240,
        background: heroBg,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to bottom, rgba(13,17,23,0.35), rgba(13,17,23,0.95))",
        }}
      />
      <div className="absolute top-4 right-4 flex gap-2 z-10">
        <button
          onClick={onEdit}
          aria-label={t("trips:editTrip")}
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{
            background: "rgba(13,17,23,0.7)",
            backdropFilter: "blur(8px)",
            border: "1px solid var(--color-border)",
            color: "var(--text-primary)",
          }}
        >
          ✎
        </button>
        <button
          onClick={onDelete}
          aria-label={t("trips:deleteTrip")}
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{
            background: "rgba(13,17,23,0.7)",
            backdropFilter: "blur(8px)",
            border: "1px solid var(--color-border)",
            color: "var(--text-primary)",
          }}
        >
          🗑
        </button>
      </div>
      <div className="absolute bottom-0 left-0 right-0 max-w-7xl mx-auto px-4 pb-5 z-[1]">
        <Link
          to="/trips"
          className="inline-flex items-center gap-1 text-xs mb-3"
          style={{ color: "var(--text-muted)" }}
        >
          ← {t("trips:detail.backToList", { defaultValue: "Zurück zu Reisen" })}
        </Link>
        <div className="flex items-end gap-3 flex-wrap">
          <h1 className="text-3xl font-display font-bold leading-tight">{trip.name}</h1>
          <StatusPill status={trip.status} t={t} />
          {trip.icon && <span className="text-2xl">{trip.icon}</span>}
        </div>
        <div
          className="flex flex-wrap gap-3 mt-2 text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          {dateRange && <span>{dateRange}</span>}
          {nights !== null && nights > 0 && (
            <span>· {t("trips:nights", { count: nights })}</span>
          )}
          {trip.destinationLabel && <span>· {trip.destinationLabel}</span>}
        </div>
      </div>
    </div>
  );
}

interface StatusPillProps {
  status: TripStatus;
  t: ReturnType<typeof useTranslation>["t"];
}

function StatusPill({ status, t }: StatusPillProps): JSX.Element {
  const c = STATUS_PILL_CLASS[status];
  return (
    <span
      className="text-[10px] uppercase tracking-wide font-medium px-2 py-1 rounded-full"
      style={{ background: c.bg, color: c.color, backdropFilter: "blur(8px)" }}
    >
      {t(`trips:status.${status}`, {
        defaultValue:
          status === "planned" ? "Geplant" : status === "in_progress" ? "Aktuell" : "Abgeschlossen",
      })}
    </span>
  );
}

interface TripStatsRowProps {
  trip: Trip;
  t: ReturnType<typeof useTranslation>["t"];
}

function TripStatsRow({ trip, t }: TripStatsRowProps): JSX.Element {
  const flightCount = trip._count?.flights ?? trip.flights?.length ?? 0;
  const cruiseCount = trip._count?.cruises ?? trip.cruises?.length ?? 0;
  const totalCost = trip.bookings?.reduce((sum, b) => sum + (b.price ?? 0), 0) ?? 0;
  const currency = trip.bookings?.find((b) => b.currency)?.currency ?? "EUR";

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      <StatTile value={flightCount} label={t("trips:detail.stats.flights", { defaultValue: "Flüge" })} />
      <StatTile
        value={cruiseCount}
        label={t("trips:detail.stats.cruises", { defaultValue: "Kreuzfahrten" })}
      />
      <StatTile
        value={trip.countries.length}
        label={t("trips:detail.stats.countries", { defaultValue: "Länder" })}
      />
      <StatTile
        value={trip.companions.length}
        label={t("trips:detail.stats.companions", { defaultValue: "Reisende" })}
      />
      <StatTile
        value={totalCost > 0 ? `${currency} ${Math.round(totalCost)}` : "—"}
        label={t("trips:totalCost")}
      />
      <StatTile
        value={trip.tags.length}
        label={t("trips:detail.stats.tags", { defaultValue: "Tags" })}
      />
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
        {t("trips:detail.notes", { defaultValue: "Notizen" })}
      </div>
      <div className="text-sm whitespace-pre-wrap leading-relaxed">{notes}</div>
    </div>
  );
}

function LinkedItemsPanel({
  trip,
  t,
}: {
  trip: Trip;
  t: ReturnType<typeof useTranslation>["t"];
}): JSX.Element {
  const flights = trip.flights ?? [];
  const cruises = trip.cruises ?? [];

  if (flights.length === 0 && cruises.length === 0) {
    return (
      <div
        className="rounded-xl p-4 text-sm"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--color-border)",
          color: "var(--text-muted)",
        }}
      >
        {t("trips:detail.noLinks", {
          defaultValue: "Noch keine Flüge oder Kreuzfahrten verknüpft.",
        })}
      </div>
    );
  }

  return (
    <div
      className="rounded-xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      {flights.length > 0 && (
        <div>
          <div
            className="px-4 py-2 text-[10px] uppercase tracking-wide"
            style={{
              color: "var(--text-muted)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            {t("trips:detail.flightsCount", {
              count: flights.length,
              defaultValue: `${flights.length} Flug · Flüge`,
            })}
          </div>
          {flights.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-3 px-4 py-2.5 text-sm"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <span
                className="w-7 h-7 rounded-md flex items-center justify-center"
                style={{ background: "var(--domain-flight-soft, var(--bg-muted))", color: "var(--domain-flight, var(--accent))" }}
              >
                ✈
              </span>
              <div className="flex-1 font-mono text-xs">
                {f.depIata ?? "???"} → {f.arrIata ?? "???"}
              </div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                {f.departureTime ? new Date(f.departureTime).toLocaleDateString() : "—"}
              </div>
            </div>
          ))}
        </div>
      )}
      {cruises.length > 0 && (
        <div>
          <div
            className="px-4 py-2 text-[10px] uppercase tracking-wide"
            style={{
              color: "var(--text-muted)",
              borderTop: flights.length > 0 ? "1px solid var(--color-border)" : "none",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            {t("trips:detail.cruisesCount", {
              count: cruises.length,
              defaultValue: `${cruises.length} Kreuzfahrt(en)`,
            })}
          </div>
          {cruises.map((c) => (
            <Link
              key={c.id}
              to={`/cruises/${c.id}`}
              className="flex items-center gap-3 px-4 py-2.5 text-sm"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <span
                className="w-7 h-7 rounded-md flex items-center justify-center"
                style={{ background: "rgba(111,160,214,0.12)", color: "var(--domain-cruise, #6fa0d6)" }}
              >
                ⚓
              </span>
              <div className="flex-1">{c.cruiseLine ?? "Kreuzfahrt"}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                {c.startDate ? new Date(c.startDate).toLocaleDateString() : "—"}
              </div>
            </Link>
          ))}
        </div>
      )}
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

function formatDateRange(start: Date | null, end: Date | null, locale: string): string | null {
  if (!start && !end) return null;
  const fmt = (d: Date): string =>
    d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
  if (start && end) {
    return start.getFullYear() === end.getFullYear()
      ? `${start.toLocaleDateString(locale, { day: "2-digit", month: "short" })} – ${fmt(end)}`
      : `${fmt(start)} – ${fmt(end)}`;
  }
  return fmt((start ?? end) as Date);
}
