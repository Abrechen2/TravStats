import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { listPlaces } from "../../lib/api/places";
import { logger } from "../../lib/logger";
import { greatCircleKm } from "../../shared/flightDuration";
import type { Place } from "../../types/place";

const SHOWN = 8;
const ROW =
  "w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-(--bg-surface) pointer-coarse:min-h-(--ts-size-touch-min)";

/**
 * Picks the place a pass-through passed (tester 2026-09-26) — the POI
 * counterpart of `StayPicker`. Every place of the user can be found: the ones
 * nearest the station come first, and a search reaches all the rest (a picker
 * that offered only the nearest eight would hide the one the reader means).
 * A failed load says so; it never reads as "you have no places".
 */
export default function PassPlacePicker({
  near,
  onPick,
}: {
  near: { lat: number | null; lon: number | null };
  onPick: (place: Place) => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    listPlaces()
      .then((rows) => {
        if (!cancelled) setPlaces(rows);
      })
      .catch((err: unknown) => {
        logger.warn("Loading places for a pass-through failed", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(() => {
    if (!places) return [];
    const needle = query.trim().toLocaleLowerCase();
    const matching = needle
      ? places.filter((p) =>
          [p.name, p.city ?? ""].some((v) => v.toLocaleLowerCase().includes(needle))
        )
      : places;
    const { lat, lon } = near;
    const ranked =
      lat !== null && lon !== null
        ? [...matching].sort(
            (a, b) => greatCircleKm(lat, lon, a.lat, a.lon) - greatCircleKm(lat, lon, b.lat, b.lon)
          )
        : [...matching].sort((a, b) => a.name.localeCompare(b.name));
    return ranked.slice(0, SHOWN);
  }, [places, query, near]);

  if (failed) {
    return (
      <p role="alert" className="text-xs" style={{ color: "var(--ts-bad)" }}>
        {t("roadtrips:place.loadError")}
      </p>
    );
  }
  if (!places) return <p className="t-caption">{t("roadtrips:place.loading")}</p>;
  if (places.length === 0) return <p className="t-caption">{t("roadtrips:place.none")}</p>;

  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      {/* A visible label, not only a placeholder that vanishes on typing (#249). */}
      <label className="flex flex-col gap-1 text-xs text-(--text-muted)">
        {t("roadtrips:place.search")}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("roadtrips:place.search")}
          className="rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
        />
      </label>
      {shown.length === 0 ? (
        <p className="t-caption">{t("roadtrips:place.noMatch")}</p>
      ) : (
        <ul className="flex flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {shown.map((p) => (
            <li key={p.id}>
              <button type="button" className={ROW} onClick={() => onPick(p)}>
                {p.name}
                {p.city ? <span className="t-caption"> · {p.city}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
