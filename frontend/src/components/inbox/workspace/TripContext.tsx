import { useState } from "react";
import { Link } from "react-router-dom";
import { tripsApi } from "../../../lib/api/trips";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import type { Trip } from "../../../types";
import Button from "../../ui/Button";
import { W } from "./model";

/** Load the full trip only when requested; the list endpoint caps nested entries. */
export default function TripContext({ tripId }: { tripId: string }) {
  const { t } = useTranslation(["dataQuality"]);
  const format = useDisplayFormat();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = async () => {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    try {
      setTrip(await tripsApi.getById(tripId));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };
  const entries = trip
    ? [
        ...(trip.flights ?? []).map((f) => ({
          key: `f:${f.id}`,
          when: f.departureTime ?? "",
          label: `${f.depIata ?? "?"} → ${f.arrIata ?? "?"}`,
          href: `/flights/${f.id}`,
          date: f.departureTime
            ? `${format.dateTime(f.departureTime, { timeZone: "UTC" })} UTC`
            : t(`${W}.unknownDay`),
        })),
        ...(trip.lodgingStays ?? []).map((s) => ({
          key: `s:${s.id}`,
          when: s.checkIn ?? "",
          label: s.lodging.name,
          href: `/lodging/${s.lodgingId}?editStay=${s.id}`,
          date: `${s.checkIn ? format.localDate(s.checkIn) : "—"} – ${s.checkOut ? format.localDate(s.checkOut) : "—"}`,
        })),
        ...(trip.stops ?? []).map((s) => ({
          key: `stop:${s.id}`,
          when: s.startDate ?? "",
          label: s.title,
          href: `/trips/${tripId}?tab=timeline`,
          date: s.startDate
            ? format.dateTime(s.startDate, { timeZone: "UTC" }) + " UTC"
            : t(`${W}.unknownDay`),
        })),
      ].sort((a, b) => a.when.localeCompare(b.when))
    : [];
  return (
    <details
      className="mt-3 rounded-lg border border-(--ts-border) p-3 text-sm"
      onToggle={(e) => {
        if (e.currentTarget.open && !trip && !loading && !failed) void load();
      }}
    >
      <summary className="cursor-pointer font-semibold">{t(`${W}.recordedContext`)}</summary>
      {loading && <p className="mt-3">{t(`${W}.loading`)}</p>}
      {failed && (
        <p role="alert" className="mt-3">
          {t(`${W}.contextFailed`)} <Button onClick={() => void load()}>{t(`${W}.retry`)}</Button>
        </p>
      )}
      {trip && (
        <>
          <ol className="mt-3 space-y-2 border-l-2 border-(--ts-border) pl-4">
            {entries.map((entry) => (
              <li key={entry.key}>
                <span className="t-caption">
                  {entry.date} · {t(`${W}.recorded`)}
                </span>
                <p>
                  <Link className="underline" to={entry.href}>
                    {entry.label}
                  </Link>
                </p>
              </li>
            ))}
          </ol>
          <Link className="mt-3 inline-block underline" to={`/trips/${tripId}?tab=timeline`}>
            {t(`${W}.fullTrip`)}
          </Link>
        </>
      )}
    </details>
  );
}
