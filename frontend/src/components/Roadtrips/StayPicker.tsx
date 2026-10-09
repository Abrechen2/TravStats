import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { createLodging, createStay, deleteLodging, listLodgings } from "../../lib/api/lodging";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import type { Lodging, LodgingType } from "../../types/lodging";
import {
  matchingLodgings,
  nearbyStays,
  staysOf,
  toPickable,
  type PickableStay,
} from "./stayPickerModel";

export type { PickableStay } from "./stayPickerModel";

const NEW_STAY_TYPES: LodgingType[] = ["campsite", "hotel", "guesthouse", "apartment", "hostel"];

// Touch sizing follows the pointer (forgejo#249): a row and an action reach
// 44 px under a finger and keep their dense desktop size under a mouse.
const ROW =
  "w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-(--bg-surface) pointer-coarse:min-h-(--ts-size-touch-min)";
const ACTION =
  "rounded-sm bg-(--accent) px-2 py-1 text-xs text-(--bg-base) disabled:opacity-40 pointer-coarse:min-h-(--ts-size-touch-min)";
const FIELD =
  "rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm pointer-coarse:min-h-(--ts-size-touch-min)";
const LABEL = "flex flex-col gap-1 text-xs text-(--text-muted)";

/**
 * Picks the stay a roadtrip station slept at, or makes one.
 *
 * The stay owns the night (design 2026-09-24 §2): a station never counts a
 * night of its own where a stay exists, so linking beats re-entering. Stays
 * whose dates touch the station's are offered first — at a station dated 14
 * July, the campsite checked into on 14 July is almost always the answer.
 *
 * Below them, every lodging of the user can be searched, with or without a
 * stay (owner board item `roadtrip-ui-rework`, "Start aus Unterkünften").
 * Choosing one lists its stays, those covering the station first; where none
 * does, the reader may create one for the station's dates — a button they
 * press, never a stay made behind their back.
 *
 * "New lodging" goes through the ordinary lodging endpoints — the lodging and
 * its stay are created exactly as the lodging page would create them — and
 * only the link is the roadtrip's. Those are two requests, so a stay that
 * fails takes its fresh lodging back with it: an empty lodging nobody asked
 * for would otherwise sit in the library.
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
  /** The station's dates, to rank nearby stays first and to date a new stay. */
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
  const [chosen, setChosen] = useState<Lodging | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState(place.name);
  const [newType, setNewType] = useState<LodgingType>("campsite");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<"lodging" | "stay" | null>(null);

  useEffect(() => setNewName(place.name), [place.name]);

  const nearby = useMemo(() => {
    const q = query.trim().toLowerCase();
    return nearbyStays(lodgings ?? [], near).filter((s) => s.label.toLowerCase().includes(q));
  }, [lodgings, near, query]);
  const found = useMemo(
    () => matchingLodgings(lodgings ?? [], query, near),
    [lodgings, near, query]
  );

  const newStayInput = {
    checkIn: near.startDate,
    checkOut: near.endDate,
    datePrecision: near.startDate ? ("DAY" as const) : ("NONE" as const),
    tripId,
  };

  const createAndPick = async (): Promise<void> => {
    if (!newName.trim()) return;
    setBusy(true);
    setFailed(null);
    try {
      const lodging = await createLodging({
        name: newName.trim(),
        type: newType,
        lat: place.lat,
        lon: place.lon,
      });
      const stay = await createStay(lodging.id, newStayInput).catch(async (err: unknown) => {
        await deleteLodging(lodging.id).catch((cleanupErr: unknown) =>
          logger.warn("Taking back the lodging of a failed stay failed", cleanupErr)
        );
        throw err;
      });
      onPick(toPickable(lodging, stay));
      setCreating(false);
    } catch (err) {
      logger.warn("Creating a stay from a roadtrip station failed", err);
      setFailed("lodging");
    } finally {
      setBusy(false);
    }
  };

  /** A stay for a lodging that already exists; the lodging stays whatever happens. */
  const createStayAndPick = async (lodging: Lodging): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      const stay = await createStay(lodging.id, newStayInput);
      onPick(toPickable(lodging, stay));
    } catch (err) {
      logger.warn("Creating a stay for an existing lodging failed", err);
      setFailed("stay");
    } finally {
      setBusy(false);
    }
  };

  const date = (value: string): string => display.date(value, { timeZone: "UTC" });
  const describe = (s: PickableStay): string =>
    s.checkIn ? `${s.label} · ${date(s.checkIn)}` : s.label;
  const describeDates = (s: PickableStay): string =>
    s.checkIn ? (s.checkOut ? `${date(s.checkIn)} – ${date(s.checkOut)}` : date(s.checkIn)) : "—";

  const stayRow = (s: PickableStay, text: string, fits = false): JSX.Element => (
    <li key={s.id}>
      <button
        type="button"
        onClick={() => onPick(s)}
        aria-pressed={s.id === selectedStayId}
        className={ROW}
        style={s.id === selectedStayId ? { background: "var(--domain-lodging-soft)" } : undefined}
      >
        {text}
        {fits && (
          <span className="ml-2 text-xs text-(--text-muted)">{t("roadtrips:stay.fitsDate")}</span>
        )}
        {s.cancelled && (
          <span className="ml-2 text-xs" style={{ color: "var(--ts-warn)" }}>
            {t("roadtrips:stay.cancelled")}
          </span>
        )}
      </button>
    </li>
  );

  if (chosen) {
    const stays = staysOf(chosen, near);
    const anyFits = stays.some((s) => s.fits);
    return (
      <div className="space-y-2 rounded-md border border-(--color-border) p-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="text-xs underline pointer-coarse:min-h-(--ts-size-touch-min)"
            onClick={() => setChosen(null)}
          >
            {t("roadtrips:stay.back")}
          </button>
          <span className="text-sm font-semibold">{chosen.name}</span>
        </div>
        {(chosen.lat === null || chosen.lon === null) && (
          <p className="text-xs" style={{ color: "var(--ts-warn)" }}>
            {t("roadtrips:stay.noCoords")}
          </p>
        )}
        {stays.length === 0 && (
          <p className="text-xs text-(--text-muted)">{t("roadtrips:stay.noStays")}</p>
        )}
        <ul className="max-h-40 space-y-1 overflow-y-auto">
          {stays.map((s) => stayRow(s, describeDates(s), s.fits))}
        </ul>
        {!anyFits && (
          <div className="flex flex-wrap items-center gap-2">
            {stays.length > 0 && (
              <p className="w-full text-xs text-(--text-muted)">{t("roadtrips:stay.noFit")}</p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void createStayAndPick(chosen)}
              className={ACTION}
            >
              {near.startDate
                ? t("roadtrips:stay.createStay", {
                    from: date(near.startDate),
                    to: near.endDate ? date(near.endDate) : "…",
                  })
                : t("roadtrips:stay.createStayUndated")}
            </button>
            {failed === "stay" && (
              <span className="text-xs" style={{ color: "var(--danger)" }}>
                {t("roadtrips:stay.createStayFailed")}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-(--color-border) p-2">
      {/* A visible label, not only a placeholder that vanishes on typing (#249). */}
      <label className={LABEL}>
        {t("roadtrips:stay.search")}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("roadtrips:stay.search")}
          className={`w-full ${FIELD}`}
        />
      </label>
      {lodgings === null && <p className="text-xs text-(--text-muted)">…</p>}
      {nearby.length > 0 && (
        <>
          <p className="text-xs font-semibold">{t("roadtrips:stay.nearbyTitle")}</p>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {nearby.map((s) => stayRow(s, describe(s)))}
          </ul>
        </>
      )}
      {lodgings !== null && found.length === 0 && (
        <p className="text-xs text-(--text-muted)">
          {query ? t("roadtrips:stay.noMatch") : t("roadtrips:stay.noneNearby")}
        </p>
      )}
      {found.length > 0 && (
        <>
          <p className="text-xs font-semibold">{t("roadtrips:stay.lodgingsTitle")}</p>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {found.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => setChosen(l)} className={ROW}>
                  {l.name}
                  {l.city && <span className="ml-2 text-xs text-(--text-muted)">{l.city}</span>}
                  {l.stays.length === 0 && (
                    <span className="ml-2 text-xs text-(--text-muted)">
                      {t("roadtrips:stay.lodgingNoStay")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {!creating ? (
        <button
          type="button"
          className="text-xs underline pointer-coarse:min-h-(--ts-size-touch-min)"
          onClick={() => setCreating(true)}
        >
          {t("roadtrips:stay.createNew")}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className={`min-w-40 flex-1 ${LABEL}`}>
            {t("roadtrips:stay.newName")}
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("roadtrips:stay.newName")}
              className={FIELD}
            />
          </label>
          <label className={LABEL}>
            {t("roadtrips:stay.newType")}
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as LodgingType)}
              className={FIELD}
            >
              {NEW_STAY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`lodging:type.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !newName.trim()}
            onClick={() => void createAndPick()}
            className={ACTION}
          >
            {t("roadtrips:stay.createAndLink")}
          </button>
          {failed === "lodging" && (
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
