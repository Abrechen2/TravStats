import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import StatCard from "./StatCard";
import StatsSectionsLoadError from "./StatsSectionsLoadError";
import { airportLabel, formatRecordValue, routeLabel } from "./recordFormat";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { statsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";
import type { Flight } from "../../types";
import type { TravelRecord } from "../../types/travelRecords";

/**
 * Rekorde — the seven records `GET /stats/records` derives (forgejo#41, #53).
 *
 * Its own component rather than another block inside `AdvancedStatsPage.tsx`,
 * which is already the largest file on the flight tab: the page mounts it and
 * knows nothing else about it.
 *
 * NOTHING HERE IS DERIVED. The longest flight, the busiest day and the streak
 * are the server's answers, and the Companion asks the same endpoint — a
 * second implementation on this side is precisely the drift the endpoint was
 * written to end. What this file does is the part a JSON body must not do:
 * apply the reader's distance unit, the reader's language and the reader's
 * date format.
 *
 * NO EVIDENCE TRIGGER, on purpose. Every record is an `extremum`
 * (`longestFlightDistanceKm` and friends are `servedIn: 2` in
 * `shared/evidenceMeasures.ts`) and `METRIC_RESOLVERS` serves only `sum` and
 * `distinct` keys today, so a trigger here would be a pointer cursor over a
 * 404 — GitHub #330 with an extra round trip.
 *
 * The airport names and the dates come from the flight rows the page has
 * ALREADY loaded, not from a second request and not from the payload: the
 * payload carries codes because a localised name in a shared body is the same
 * mistake as a formatted number. A code the loaded set does not know keeps its
 * code, and a record whose flight is missing simply shows no date. Abstention
 * again, one level down.
 */

interface RecordsSectionProps {
  /** The page's countable flights — read for names and dates only. */
  flights: readonly Flight[];
}

/** Which of the seven this build knows how to draw, in the server's order. */
const KNOWN_IDS = new Set<TravelRecord["id"]>([
  "longest-flight",
  "shortest-flight",
  "busiest-day",
  "longest-aloft",
  "biggest-delay",
  "northernmost",
  "longest-streak",
]);

export default function RecordsSection({ flights }: RecordsSectionProps): JSX.Element {
  const { t, i18n } = useTranslation(["stats", "common"]);
  const distanceUnit = useSettingsStore((s) => s.units.distanceUnit);
  const display = useDisplayFormat();

  const [records, setRecords] = useState<TravelRecord[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback((): void => {
    setFailed(false);
    statsApi
      .getRecords()
      .then((rows) => setRecords(rows.filter((row) => KNOWN_IDS.has(row.id))))
      .catch((err) => {
        // A failed load must never fall through to an empty grid, which reads
        // as "you have no records" — the one thing it does not mean.
        setRecords(null);
        setFailed(true);
        logger.error("Failed to load travel records:", err);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const airportNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const flight of flights) {
      if (flight.depIata && flight.depName) names.set(flight.depIata.toUpperCase(), flight.depName);
      if (flight.arrIata && flight.arrName) names.set(flight.arrIata.toUpperCase(), flight.arrName);
    }
    return names;
  }, [flights]);

  const flightsById = useMemo(() => {
    const byId = new Map<string, Flight>();
    for (const flight of flights) byId.set(flight.id, flight);
    return byId;
  }, [flights]);

  /** A calendar day, read in UTC — "2024-03-07" is a date, not an instant. */
  const calendarDay = (iso: string | undefined): string | null =>
    iso ? display.date(`${iso}T00:00:00Z`, { timeZone: "UTC" }) : null;

  const detailOf = (record: TravelRecord): string | null => {
    switch (record.id) {
      case "busiest-day":
        return (record.legs ?? []).filter(Boolean).join(" → ") || null;
      case "northernmost":
        return airportLabel(record.airportIata, airportNames);
      case "longest-streak":
        return record.startDate && record.endDate
          ? t("stats:records.range", {
              start: calendarDay(record.startDate),
              end: calendarDay(record.endDate),
            })
          : null;
      default:
        return routeLabel(record);
    }
  };

  const footnoteOf = (record: TravelRecord): JSX.Element | string | null => {
    const flight = record.flightId ? flightsById.get(record.flightId) : undefined;
    const stamp =
      record.date !== undefined
        ? calendarDay(record.date)
        : flight?.departureTime
          ? display.date(flight.departureTime)
          : null;
    const number = record.flightNumber ?? flight?.flightNumber ?? null;
    const parts = [number, stamp].filter((part): part is string => Boolean(part));

    if (!record.flightId) return parts.length > 0 ? parts.join(" · ") : null;

    return (
      <>
        {parts.length > 0 && <span>{parts.join(" · ")} · </span>}
        <Link to={`/flights/${record.flightId}`} className="underline">
          {t("stats:records.openFlight")}
        </Link>
      </>
    );
  };

  return (
    <section className="mt-8" aria-labelledby="stats-records-heading">
      <h2
        id="stats-records-heading"
        className="text-3xl font-bold mb-2"
        style={{ color: "var(--text-primary)" }}
      >
        {t("stats:records.title")}
      </h2>
      <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
        {t("stats:records.intro")}
      </p>

      {failed && <StatsSectionsLoadError onRetry={load} />}

      {!failed && records === null && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("common:loading.default")}
        </p>
      )}

      {/* An empty array is a real answer: the account has no flight a record
          can be derived from. It is not a failure, and it is not zeroes. */}
      {!failed && records !== null && records.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("stats:records.empty")}
        </p>
      )}

      {!failed && records !== null && records.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {records.map((record) => (
            <StatCard
              key={record.id}
              valueSize="md"
              title={t(`stats:records.names.${record.id}`)}
              value={formatRecordValue(record, { distanceUnit, language: i18n.language, t })}
              description={detailOf(record) ?? t("stats:records.noDetail")}
              footnote={footnoteOf(record)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
