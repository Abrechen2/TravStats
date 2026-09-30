import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { toursApi } from "../../lib/api/tours";
import { logger } from "../../lib/logger";
import type { TourRoute } from "../../types/tour";

interface Props {
  route: TourRoute;
  /** The trip in the path, when the tour is edited on a trip's page. */
  tripId: string | undefined;
  onSaved: (route: TourRoute) => void;
}

/**
 * The day of a day tour and when it started (acceptance D2, 2026-09-26).
 * Without it a standalone tour had no day anywhere, and the trip suggestions
 * could never place it. A recording's start day prefills the date on the
 * server; the reader can always change it here.
 *
 * Saved on change, one field at a time; a refusal says so beside the fields.
 */
export default function TourDayEditor({ route, tripId, onSaved }: Props): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const [date, setDate] = useState(route.date ?? "");
  const [time, setTime] = useState(route.startTime ?? "");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDate(route.date ?? "");
    setTime(route.startTime ?? "");
  }, [route.date, route.startTime]);

  const save = async (next: { date?: string | null; startTime?: string | null }) => {
    setFailed(false);
    try {
      onSaved(await toursApi.update(tripId, route.id, next));
    } catch (err) {
      logger.warn("TourDayEditor: saving the tour's day failed", err);
      setFailed(true);
    }
  };

  const inputClass = "rounded-sm border border-(--color-border) bg-transparent px-2 py-0.5 text-sm";
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={date}
        aria-label={t("trips:tours.day.date")}
        className={inputClass}
        onChange={(e) => {
          setDate(e.target.value);
          void save(e.target.value ? { date: e.target.value } : { date: null });
        }}
      />
      <input
        type="time"
        value={time}
        disabled={!date}
        aria-label={t("trips:tours.day.startTime")}
        className={inputClass}
        onChange={(e) => {
          setTime(e.target.value);
          void save({ startTime: e.target.value || null });
        }}
      />
      {failed && (
        <span role="alert" className="text-xs" style={{ color: "var(--danger)" }}>
          {t("trips:tours.day.saveError")}
        </span>
      )}
    </span>
  );
}
