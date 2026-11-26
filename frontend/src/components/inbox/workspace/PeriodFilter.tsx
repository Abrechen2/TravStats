import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { W } from "./model";

/** From–to days for the inbox (owner 2026-11-26), kept in `?from=` / `?to=`. */
export default function PeriodFilter({
  from,
  to,
  onChange,
}: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
}): JSX.Element {
  const { t } = useTranslation(["dataQuality"]);
  return (
    <div
      className="flex flex-wrap items-center gap-2 t-caption"
      role="group"
      aria-label={t(`${W}.period.label`)}
    >
      <label className="flex items-center gap-1">
        {t(`${W}.period.from`)}
        <input
          type="date"
          className="ts-control"
          value={from ?? ""}
          onChange={(e) => onChange(e.target.value || null, to)}
        />
      </label>
      <label className="flex items-center gap-1">
        {t(`${W}.period.to`)}
        <input
          type="date"
          className="ts-control"
          value={to ?? ""}
          onChange={(e) => onChange(from, e.target.value || null)}
        />
      </label>
      {(from || to) && (
        <button type="button" className="underline" onClick={() => onChange(null, null)}>
          {t(`${W}.period.clear`)}
        </button>
      )}
    </div>
  );
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A valid day from the URL, else null. */
export const dayParam = (v: string | null): string | null => (v && DAY.test(v) ? v : null);

/** In the period when its travel day lies inside it; an item without a day is out once a period is set. */
export function inPeriod(day: string | null, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  if (!day) return false;
  return (!from || day >= from) && (!to || day <= to);
}
