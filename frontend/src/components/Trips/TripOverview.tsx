import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";
import { differenceInCalendarDays } from "date-fns";
import type { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useRailVisible } from "../../hooks/useRailVisible";
import { useRentalVisible } from "../../hooks/useRentalVisible";
import type { Trip } from "../../types";
import { tripCostTotals } from "../../lib/tripCost";
import { formatDate } from "../../lib/displayFormat";
import { railDeparture } from "../../lib/entityTimes";
import { formatCurrency } from "../../lib/units";
import { statusPillStyle } from "../table/statusPillStyle";
import { Icon, type IconName } from "../ui/Icon";
import DetailSection from "../ui/DetailSection";
import PeopleList from "../ui/PeopleList";
import TripSummaryPanel from "./TripSummaryPanel";
import { useTripRoadtrips } from "../Roadtrips/useTripRoadtrips";
import DocumentsSection from "../documents/DocumentsSection";

type T = ReturnType<typeof useTranslation>["t"];

function Kpi({
  value,
  label,
  wide,
}: {
  value: ReactNode;
  label: string;
  /** Full row on a phone: a multi-currency total does not fit half a screen. */
  wide?: boolean;
}): JSX.Element {
  return (
    <div
      className={`flex min-w-0 flex-col ${wide ? "col-span-2 sm:col-span-1" : ""}`}
      style={{
        gap: 2,
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
        padding: "var(--ts-space-lg) var(--ts-space-xl)",
      }}
    >
      <span
        style={{
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 1.15,
          color: "var(--ts-text-bright)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <span className="t-caption">{label}</span>
    </div>
  );
}

interface EntryRowProps {
  to: string;
  icon: IconName;
  title: string;
  sub: string | null;
  aside?: ReactNode;
}

/** One linked entry: icon tile, what and when, a status, a chevron — the whole row is the link. */
function EntryRow({ to, icon, title, sub, aside }: EntryRowProps): JSX.Element {
  return (
    <li>
      <Link
        to={to}
        className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-[var(--ts-surface2)]"
      >
        <span
          aria-hidden="true"
          className="flex shrink-0 items-center justify-center rounded-full"
          style={{
            width: 34,
            height: 34,
            background: "var(--ts-surface2)",
            color: "var(--ts-muted)",
          }}
        >
          <Icon name={icon} size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className="truncate"
            style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}
          >
            {title}
          </span>
          {sub && <span className="t-caption truncate">{sub}</span>}
        </span>
        {aside}
        <span aria-hidden="true" style={{ color: "var(--ts-muted)" }}>
          ›
        </span>
      </Link>
    </li>
  );
}

function EntryList({
  title,
  count,
  children,
}: {
  title: string;
  count: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="t-label-mono">{title}</h2>
        <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
          {count}
        </span>
      </div>
      <ul
        className="divide-y divide-[var(--ts-border)] overflow-hidden"
        style={{
          background: "var(--ts-surface)",
          border: "1px solid var(--ts-border)",
          borderRadius: "var(--ts-radius-card)",
        }}
      >
        {children}
      </ul>
    </section>
  );
}

// In the user's date format (Settings → Display), read in UTC as before. It
// printed the ISO day ("2021-01-15") on a German page until 2026-09-26.
const dateOf = (iso: string | null | undefined): string | null =>
  iso ? formatDate(iso, { timeZone: "UTC" }) || null : null;

/** A train ride's day on its departure station's calendar; null when nothing places it. */
const railDay = (j: Parameters<typeof railDeparture>[0]): string | null => {
  const local = railDeparture(j)?.local;
  return local ? formatDate(local.slice(0, 10)) || null : null;
};

/**
 * The overview tab of a trip, round 4 ("Reise Detail"): three figures, the
 * linked entries per area as rows that open the entry, notes, and beside
 * them the travellers and the summary.
 *
 * It replaces seven stat tiles — several of them a bare "0" for an area the
 * trip does not touch ("0 Kreuzfahrten", "0 Tags") — and a notes box that
 * showed the form's placeholder text as if it were content. The linked
 * entries were reachable only through the timeline tab.
 */
export default function TripOverview({
  trip,
  t,
  language,
  onChanged,
}: {
  trip: Trip;
  t: T;
  language: string;
  onChanged: () => void;
}): JSX.Element {
  const { isEnabled } = useEnabledDomains();
  const cruiseEnabled = isEnabled("cruise");
  const lodgingEnabled = isEnabled("lodging");
  const flights = trip.flights ?? [];
  const cruises = cruiseEnabled ? (trip.cruises ?? []) : [];
  const stays = lodgingEnabled ? (trip.lodgingStays ?? []) : [];
  const railJourneys = useRailVisible() ? (trip.railJourneys ?? []) : [];
  const rentals = useRentalVisible() ? (trip.rentalBookings ?? []) : [];

  const days =
    trip.startDate && trip.endDate
      ? differenceInCalendarDays(new Date(trip.endDate), new Date(trip.startDate)) + 1
      : null;
  // Through `formatCurrency`, like the trip card: the tile wrote "EUR 40206"
  // while the card beside it wrote "40.206 €" (forgejo#86).
  // The server's figure (forgejo#274) — trains, rentals and expenses included,
  // a hidden domain left out — never a sum of the rows this page happens to hold.
  const costTotals = tripCostTotals(trip.cost);
  const unpriced = trip.cost?.unpricedEntries ?? 0;

  const kpis: { key: string; value: ReactNode; label: string }[] = [
    ...(days !== null && days > 0
      ? [{ key: "days", value: days, label: t("trips:overview.daysAway") }]
      : []),
    ...(trip.countries.length > 0
      ? [
          {
            key: "countries",
            value: trip.countries.length,
            label: t("trips:detail.stats.countries"),
          },
        ]
      : []),
    ...(costTotals.length > 0
      ? [
          {
            key: "cost",
            value: costTotals
              .map((c) => formatCurrency(c.total, c.currency, { compact: true, language }))
              .join(" + "),
            // A missing price is said, not read as free: the figure is a floor.
            label:
              unpriced > 0
                ? `${t("trips:totalCost")} · ${t("trips:costUnpriced", { count: unpriced })}`
                : t("trips:totalCost"),
          },
        ]
      : []),
  ];

  const roadtrips = useTripRoadtrips(trip.id, isEnabled("roadtrip"));
  // Every area the overview lists counts — a trip holding only a train ride
  // or a rental car said "nothing linked" above an entry it was not showing.
  const nothingLinked =
    flights.length +
      cruises.length +
      stays.length +
      roadtrips.length +
      railJourneys.length +
      rentals.length ===
    0;
  // The side column only when it has something to hold: an empty 1fr beside
  // the entries pushed them into two thirds of the page for nothing.
  // Mirrors TripSummaryPanel's own condition: the beta gate went with the
  // key (main, 2026-09-18), and what decides whether that card appears is
  // now the demo refusal alone. Asking the same question here keeps the
  // column from reserving space for a card that will not render.
  const isSharedDemo = useIsDemoAccount();
  const hasSide =
    trip.companions.length > 0 || trip.tags.length > 0 || Boolean(trip.summary) || !isSharedDemo;

  return (
    <div className="flex flex-col gap-6">
      {kpis.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {kpis.map((k) => (
            <Kpi key={k.key} value={k.value} label={k.label} wide={k.key === "cost"} />
          ))}
        </div>
      )}

      <div className={`grid grid-cols-1 gap-6 ${hasSide ? "lg:grid-cols-[1.6fr_1fr]" : ""}`}>
        <div className="flex min-w-0 flex-col gap-6">
          {flights.length > 0 && (
            <EntryList
              title={t("trips:detail.stats.flights")}
              count={t("trips:detail.flightsCount", { count: flights.length })}
            >
              {flights.map((f) => (
                <EntryRow
                  key={f.id}
                  to={`/flights/${f.id}`}
                  icon="plane"
                  title={[
                    [f.airline, f.flightNumber].filter(Boolean).join(" "),
                    `${f.depIata ?? "—"} → ${f.arrIata ?? "—"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  sub={dateOf(f.departureTime)}
                  aside={
                    f.status ? (
                      // A wrapper carries `hidden`: `.ts-status-pill` sets its own
                      // display unlayered and would beat the utility.
                      <span className="hidden sm:inline">
                        <span className="ts-status-pill" style={statusPillStyle(f.status)}>
                          {t(`flights:status.${f.status}`, { defaultValue: f.status })}
                        </span>
                      </span>
                    ) : null
                  }
                />
              ))}
            </EntryList>
          )}

          {cruises.length > 0 && (
            <EntryList
              title={t("trips:detail.stats.cruises")}
              count={t("trips:detail.cruisesCount", { count: cruises.length })}
            >
              {cruises.map((c) => (
                <EntryRow
                  key={c.id}
                  to={`/cruises/${c.id}`}
                  icon="ship"
                  title={[c.ship?.name ?? c.shipNameOverride ?? c.cruiseLine, c.routeName]
                    .filter(Boolean)
                    .join(" · ")}
                  sub={[dateOf(c.startDate), dateOf(c.endDate)].filter(Boolean).join(" – ") || null}
                />
              ))}
            </EntryList>
          )}

          {stays.length > 0 && (
            <EntryList
              title={t("trips:detail.stats.lodging")}
              count={t("lodging:field.staysCount", { count: stays.length })}
            >
              {stays.map((s) => (
                <EntryRow
                  key={s.id}
                  to={`/lodging/${s.lodgingId}`}
                  icon="bed"
                  title={s.lodging.name}
                  sub={
                    [
                      [dateOf(s.checkIn), dateOf(s.checkOut)].filter(Boolean).join(" – "),
                      s.nights ? t("trips:nights", { count: s.nights }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || null
                  }
                />
              ))}
            </EntryList>
          )}

          {roadtrips.length > 0 && (
            <EntryList
              title={t("roadtrips:pageTitle")}
              count={t("roadtrips:list.count", { count: roadtrips.length })}
            >
              {roadtrips.map((r) => (
                <EntryRow
                  key={r.id}
                  to={`/roadtrips/${r.id}`}
                  icon="caravan"
                  title={r.name}
                  sub={[
                    r.vehicle ? t(`roadtrips:vehicle.${r.vehicle}`) : null,
                    t("roadtrips:stationCount", { count: r.stopCount }),
                    `${Math.round(r.drivenKm)} km`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ))}
            </EntryList>
          )}

          {railJourneys.length > 0 && (
            <EntryList
              title={t("trips:detail.stats.rail")}
              count={t("trips:detail.railCount", { count: railJourneys.length })}
            >
              {railJourneys.map((j) => (
                <EntryRow
                  key={j.id}
                  to={`/rail/${j.id}`}
                  icon="train-front"
                  title={[
                    [j.trainCategory, j.trainNumber].filter(Boolean).join(" "),
                    `${j.depStationName} → ${j.arrStationName}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  sub={railDay(j)}
                />
              ))}
            </EntryList>
          )}

          {rentals.length > 0 && (
            <EntryList
              title={t("trips:detail.stats.rental")}
              count={t("trips:detail.rentalCount", { count: rentals.length })}
            >
              {rentals.map((r) => (
                <EntryRow
                  key={r.id}
                  to={`/rentals/${r.id}`}
                  icon="car"
                  title={[
                    r.provider,
                    r.returnStationName === r.pickupStationName
                      ? r.pickupStationName
                      : `${r.pickupStationName} → ${r.returnStationName}`,
                  ].join(" · ")}
                  sub={
                    [
                      formatDate(r.pickupTime, { timeZone: r.pickupTimezone }),
                      formatDate(r.returnTime, { timeZone: r.returnTimezone }),
                    ]
                      .filter(Boolean)
                      .join(" – ") || null
                  }
                />
              ))}
            </EntryList>
          )}

          {nothingLinked && <p className="t-caption">{t("trips:detail.noLinks")}</p>}

          {/* On the overview rather than in TripDetailPage: that page is frozen
              at its recorded size by the file-size ratchet, and the trip's own
              papers belong with the trip's own summary anyway. */}
          <DocumentsSection entry={{ type: "trip", id: trip.id }} />

          {trip.notes && (
            <DetailSection title={t("trips:detail.notes")}>
              <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--ts-text)" }}>
                {trip.notes}
              </p>
            </DetailSection>
          )}
        </div>

        {hasSide && (
          <div className="flex min-w-0 flex-col gap-6">
            {trip.companions.length > 0 && (
              <DetailSection title={t("trips:detail.companions")}>
                <PeopleList names={trip.companions} />
              </DetailSection>
            )}
            <TripSummaryPanel trip={trip} t={t} language={language} onChanged={onChanged} />
            {trip.tags.length > 0 && (
              <DetailSection title={t("trips:detail.tags")}>
                <div className="flex flex-wrap gap-1.5">
                  {trip.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border px-2.5 py-0.5 text-xs"
                      style={{ borderColor: "var(--ts-border)", color: "var(--ts-muted)" }}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </DetailSection>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
