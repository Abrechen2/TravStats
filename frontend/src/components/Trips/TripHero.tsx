import type { JSX } from "react";
import { Link } from "react-router-dom";
import { differenceInCalendarDays } from "date-fns";
import type { useTranslation } from "../../hooks/useTranslation";
import type { Trip, TripStatus } from "../../types";

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

/** The banner at the top of the trip page: cover, name, status, dates, companions. */
export default function TripHero({
  trip,
  locale,
  t,
  onEdit,
  onDelete,
}: TripHeroProps): JSX.Element {
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
          title={t("trips:editTrip")}
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
          title={t("trips:deleteTrip")}
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
      <div className="absolute bottom-0 left-0 right-0 max-w-7xl mx-auto px-4 pb-5 z-1">
        <Link
          to="/trips"
          className="inline-flex items-center gap-1 text-xs mb-3"
          style={{ color: "var(--text-muted)" }}
        >
          ← {t("trips:detail.backToList")}
        </Link>
        <div className="flex items-end gap-3 flex-wrap">
          <h1 className="text-3xl font-display font-bold leading-tight">{trip.name}</h1>
          <StatusPill status={trip.status} t={t} />
          {trip.icon && <span className="text-2xl">{trip.icon}</span>}
        </div>
        <div className="flex flex-wrap gap-3 mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          {dateRange && <span>{dateRange}</span>}
          {nights !== null && nights > 0 && <span>· {t("trips:nights", { count: nights })}</span>}
          {trip.destinationLabel && <span>· 📍 {trip.destinationLabel}</span>}
          {trip.companions.length > 0 && (
            <span>
              · 👥 {trip.companions.slice(0, 3).join(", ")}
              {trip.companions.length > 3 ? " …" : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  status,
  t,
}: {
  status: TripStatus;
  t: ReturnType<typeof useTranslation>["t"];
}): JSX.Element {
  const c = STATUS_PILL_CLASS[status];
  return (
    <span
      className="text-[10px] uppercase tracking-wide font-medium px-2 py-1 rounded-full"
      style={{ background: c.bg, color: c.color, backdropFilter: "blur(8px)" }}
    >
      {t(`trips:status.${status}`)}
    </span>
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
