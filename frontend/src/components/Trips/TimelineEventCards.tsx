import { deadlineSummary } from "../../lib/deadlines";
import { useState } from "react";
import { Link } from "react-router-dom";
import { formatLocalClock } from "../../lib/displayFormat";
import { cruiseStopArrival, cruiseStopDeparture } from "../../lib/entityTimes";
import { clockOf, type TimeValue } from "../../shared/time";
import { formatAmount } from "../../lib/units";
import { type TimelineEvent } from "../../lib/tripTimelineEvents";
import { ExpandableEventCard } from "../../components/Trip/ExpandableEventCard";
import { RowActions } from "../../components/Trips/TimelineJournalCard";
import { useTranslation } from "../../hooks/useTranslation";
import { DetailRow, OpenFullLink } from "../../components/Trips/TimelineDetailParts";
import { formatTimelineDate } from "../../lib/tripTimeline";
import { placeCategoryIcon } from "../../lib/placeCategoryDisplay";
import { usePlaceCategories } from "../../hooks/usePlaceCategories";
import { placeSubtitle } from "../../lib/placeNames";

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

export function dotColor(ev: TimelineEvent): string {
  switch (ev.kind) {
    case "flight":
      return "var(--domain-flight, var(--accent))";
    case "cruise":
      return "var(--domain-cruise)";
    case "rail":
      return "var(--domain-rail)";
    case "ferry":
      return "var(--ts-domain-ferry)";
    case "bus":
      return "var(--ts-domain-bus)";
    case "rental-pickup":
    case "rental-return":
      return "var(--ts-domain-rental)";
    case "stop":
    case "place-visit":
      return "var(--domain-poi)";
    case "journal":
      return "var(--ts-info)";
    case "note":
      return "var(--text-muted)";
    case "lodging-checkin":
    case "lodging-checkout":
      return "var(--domain-lodging)";
  }
}

export function EventCard({
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
  /** The date text on the PLACE's clock (`formatTimelineDate(ev.when)`), never the reader's. */
  dateLabel: string;
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
          {dateLabel}
        </time>
        {actions}
      </div>
    </div>
  );
}

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

/**
 * The clock time of a cruise stop, on the PORT's clock (the value's `local`).
 * Read in the viewer's zone, Barcelona's 12:00 departure moved by an hour for
 * a reader in London.
 */
function stopClock(value: TimeValue | null): string | null {
  const clock = value ? clockOf(value) : null;
  return clock ? formatLocalClock(clock) : null;
}

export function FlightCard({
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
      bg="var(--domain-flight-soft)"
      iconColor="var(--domain-flight, var(--accent))"
      title={ev.title}
      subtitle={ev.subtitle}
      date={ev.date}
      dateLabel={formatTimelineDate(ev.when)}
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

export function CruiseCard({
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
      bg="var(--domain-cruise-soft)"
      iconColor="var(--domain-cruise)"
      title={ev.title}
      subtitle={ev.subtitle}
      date={ev.date}
      dateLabel={formatTimelineDate(ev.when)}
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
                    {[stopClock(cruiseStopArrival(stop)), stopClock(cruiseStopDeparture(stop))]
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
 * the `--domain-lodging` CSS var) and the hotel icon, and
 * clicking it navigates to that hotel's own detail page — the whole point
 * being that a hotel linked to a trip is no longer a dead end.
 */
export function LodgingCheckCard({
  ev,
  t,
  implausible = false,
}: {
  ev: Extract<TimelineEvent, { kind: "lodging-checkin" | "lodging-checkout" }>;
  t: ReturnType<typeof useTranslation>["t"];
  /** #6: hotel sits far from every trip leg — shown on the check-in entry. */
  implausible?: boolean;
}): JSX.Element {
  const { stay } = ev;
  const isCheckIn = ev.kind === "lodging-checkin";
  const title = t(
    isCheckIn ? "trips:detail.timeline.lodgingCheckIn" : "trips:detail.timeline.lodgingCheckOut",
    { name: stay.lodging.name }
  );
  const subtitle = formatTimelineDate(ev.when); // a stay is a DAY at the hotel, not the viewer's
  // Only on the check-in entry, so the hint appears once per stay, not twice.
  const showHint = implausible && isCheckIn;
  return (
    <Link to={`/lodging/${stay.lodgingId}`} className="block">
      <EventCard
        icon="🏨"
        bg="var(--domain-lodging-soft)"
        iconColor="var(--domain-lodging)"
        title={title}
        subtitle={
          showHint ? `${subtitle} · ⚠︎ ${t("trips:detail.timeline.lodgingFarFromTrip")}` : subtitle
        }
        date={ev.date}
        dateLabel={formatTimelineDate(ev.when)}
        meta={isCheckIn ? (deadlineSummary(stay.times, t) ?? undefined) : undefined}
      />
    </Link>
  );
}

export function StopCard({
  ev,
  onEdit,
  onDelete,
}: {
  ev: Extract<TimelineEvent, { kind: "stop" }>;
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
      bg="var(--domain-poi-soft)"
      iconColor="var(--domain-poi)"
      title={s.title}
      subtitle={subtitle}
      meta={s.notes ?? undefined}
      date={ev.date}
      dateLabel={formatTimelineDate(ev.when)}
      actions={<RowActions onEdit={onEdit} onDelete={onDelete} />}
    />
  );
}

/**
 * A place visited on this trip. Deliberately has no edit/delete actions: the
 * place is not owned by the trip, so deleting it here would be deleting it
 * from every other trip and from the globe. Editing happens on the place.
 */
export function PlaceVisitCard({
  ev,
}: {
  ev: Extract<TimelineEvent, { kind: "place-visit" }>;
}): JSX.Element {
  const { customs } = usePlaceCategories();
  const { place, visit } = ev;
  return (
    <EventCard
      icon={placeCategoryIcon(place.category, customs)}
      bg="var(--domain-poi-soft)"
      iconColor="var(--domain-poi)"
      title={place.name}
      subtitle={placeSubtitle(place) || null}
      meta={visit.notes ?? undefined}
      date={ev.date}
      dateLabel={formatTimelineDate(ev.when)}
    />
  );
}
