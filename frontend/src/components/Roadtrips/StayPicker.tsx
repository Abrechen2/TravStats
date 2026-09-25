import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { createLodging, createStay, deleteLodging, listLodgings } from "../../lib/api/lodging";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import type { Lodging, LodgingType } from "../../types/lodging";

/** A stay the picker can offer, flattened out of its lodging. */
export interface PickableStay {
  id: string;
  label: string;
  checkIn: string | null;
  checkOut: string | null;
  /** Offered, but marked: a cancelled stay links fine and counts no night. */
  cancelled: boolean;
}

const NEW_STAY_TYPES: LodgingType[] = ["campsite", "hotel", "guesthouse", "apartment", "hostel"];
const DAY_MS = 86_400_000;

function flatten(lodgings: Lodging[]): PickableStay[] {
  return lodgings.flatMap((l) =>
    l.stays.map((s) => ({
      id: s.id,
      label: l.name,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      cancelled: s.status === "cancelled",
    }))
  );
}

/**
 * Picks the stay a roadtrip station slept at, or makes one.
 *
 * The stay owns the night (design 2026-09-24 §2): a station never counts a
 * night of its own where a stay exists, so linking beats re-entering. Stays
 * whose dates touch the station's come first — at a station dated 14 July,
 * the campsite checked into on 14 July is almost always the answer.
 *
 * "New" goes through the ordinary lodging endpoints — the lodging and its
 * stay are created exactly as the lodging page would create them, with its
 * currency, status and FX rules — and only the link is the roadtrip's. Those
 * are two requests, so a stay that fails takes its fresh lodging back with
 * it: an empty lodging nobody asked for would otherwise sit in the library.
 */
export default function StayPicker({
  selectedStayId,
  near,
  place,
  tripId,
  onPick,
  lodgings,
}: {
  selectedStayId: string | null;
  /** The station's dates, to rank nearby stays first. */
  near: { startDate: string | null; endDate: string | null };
  /** Where a new lodging would be — the station's own point and name. */
  place: { name: string; lat: number | null; lon: number | null };
  tripId: string | null;
  onPick: (stay: PickableStay) => void;
  /** Loaded once by the editor and shared by every row. */
  lodgings: Lodging[] | null;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips", "lodging"]);
  const display = useDisplayFormat();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState(place.name);
  const [newType, setNewType] = useState<LodgingType>("campsite");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => setNewName(place.name), [place.name]);

  const options = useMemo(() => {
    const all = flatten(lodgings ?? []);
    const anchor = near.startDate ? new Date(near.startDate).getTime() : null;
    const distance = (s: PickableStay): number => {
      if (anchor === null || !s.checkIn) return Number.POSITIVE_INFINITY;
      return Math.abs(new Date(s.checkIn).getTime() - anchor) / DAY_MS;
    };
    const q = query.trim().toLowerCase();
    return all
      .filter((s) => (q === "" ? distance(s) <= 3 : s.label.toLowerCase().includes(q)))
      .sort((a, b) => distance(a) - distance(b))
      .slice(0, 12);
  }, [lodgings, near.startDate, query]);

  const createAndPick = async (): Promise<void> => {
    if (!newName.trim()) return;
    setBusy(true);
    setFailed(false);
    try {
      const lodging = await createLodging({
        name: newName.trim(),
        type: newType,
        lat: place.lat,
        lon: place.lon,
      });
      const stay = await createStay(lodging.id, {
        checkIn: near.startDate,
        checkOut: near.endDate,
        datePrecision: near.startDate ? "DAY" : "NONE",
        tripId,
      }).catch(async (err: unknown) => {
        await deleteLodging(lodging.id).catch((cleanupErr: unknown) =>
          logger.warn("Taking back the lodging of a failed stay failed", cleanupErr)
        );
        throw err;
      });
      onPick({
        id: stay.id,
        label: lodging.name,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        cancelled: false,
      });
      setCreating(false);
    } catch (err) {
      logger.warn("Creating a stay from a roadtrip station failed", err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const describe = (s: PickableStay): string =>
    s.checkIn ? `${s.label} · ${display.date(s.checkIn, { timeZone: "UTC" })}` : s.label;

  return (
    <div className="space-y-2 rounded-md border border-(--color-border) p-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("roadtrips:stay.search")}
        aria-label={t("roadtrips:stay.search")}
        className="w-full rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
      />
      {lodgings === null && <p className="text-xs text-(--text-muted)">…</p>}
      {lodgings !== null && options.length === 0 && (
        <p className="text-xs text-(--text-muted)">
          {query ? t("roadtrips:stay.noMatch") : t("roadtrips:stay.noneNearby")}
        </p>
      )}
      <ul className="max-h-40 space-y-1 overflow-y-auto">
        {options.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onPick(s)}
              aria-pressed={s.id === selectedStayId}
              className="w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-(--bg-surface)"
              style={
                s.id === selectedStayId ? { background: "var(--domain-lodging-soft)" } : undefined
              }
            >
              {describe(s)}
              {s.cancelled && (
                <span className="ml-2 text-xs" style={{ color: "var(--ts-warn)" }}>
                  {t("roadtrips:stay.cancelled")}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {!creating ? (
        <button type="button" className="text-xs underline" onClick={() => setCreating(true)}>
          {t("roadtrips:stay.createNew")}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label={t("roadtrips:stay.newName")}
            placeholder={t("roadtrips:stay.newName")}
            className="min-w-40 flex-1 rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as LodgingType)}
            aria-label={t("roadtrips:stay.newType")}
            className="rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
          >
            {NEW_STAY_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`lodging:type.${type}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !newName.trim()}
            onClick={() => void createAndPick()}
            className="rounded-sm bg-(--accent) px-2 py-1 text-xs text-(--bg-base) disabled:opacity-40"
          >
            {t("roadtrips:stay.createAndLink")}
          </button>
          {failed && (
            <span className="text-xs" style={{ color: "var(--danger)" }}>
              {t("roadtrips:stay.createFailed")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Loads the lodging library once for every picker on the page. */
export function useLodgingLibrary(enabled: boolean): Lodging[] | null {
  const [lodgings, setLodgings] = useState<Lodging[] | null>(null);
  useEffect(() => {
    if (!enabled || lodgings !== null) return;
    let cancelled = false;
    listLodgings({})
      .then((rows) => !cancelled && setLodgings(rows))
      .catch((err: unknown) => {
        logger.warn("Loading lodgings for the stay picker failed", err);
        if (!cancelled) setLodgings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, lodgings]);
  return lodgings;
}
