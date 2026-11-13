import { useEffect, useState } from "react";
import type { JSX } from "react";
import { PlaceFormModal } from "../../../components/places/PlaceFormModal";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import { visitTime } from "../../../lib/entityTimes";
import { trackErrorKey } from "../../../lib/api/travtrack";
import { createVisit, getPlace, listPlaces } from "../../../lib/api/places";
import { calculateDistance } from "../../../lib/geo";
import { logger } from "../../../lib/logger";
import { dayOf } from "../../../shared/time";
import type { Place } from "../../../types/place";
import { pillStyle } from "./trackMapStyle";

/** An own place this close to the stop (and carrying its name) is offered before a new one is made. */
const NEARBY_KM = 0.15;

/**
 * "In Orte übernehmen" on a stop: pick one of the own places (the ones that
 * already carry the stop's name nearby are offered first, so a retry or a
 * second visit does not make a copy) or make a new one in the place form,
 * prefilled with the stop's name and position. A visit on the stop's day is
 * an explicit tick, never automatic, and is skipped when the place already
 * has one that day.
 */
export default function TrackStopToPlaces({
  name,
  lat,
  lon,
  day,
  height,
}: {
  name: string;
  lat: number;
  lon: number;
  /** The stop's calendar day (`YYYY-MM-DD`), the day a recorded visit gets. */
  day: string;
  height: number;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Place[] | null>(null);
  const [lookupFailed, setLookupFailed] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Place | null>(null);
  const [withVisit, setWithVisit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<"linked" | "visit" | "visitExists" | null>(null);

  const search = async (q: string) => {
    setLookupFailed(null);
    try {
      setFound(await listPlaces({ q, limit: 20 }));
    } catch (err: unknown) {
      logger.warn("TravTrack stop: own places could not be searched", err);
      setFound(null);
      setLookupFailed(trackErrorKey(err));
    }
  };

  // Own places already named like the stop and standing next to it.
  useEffect(() => {
    if (!open || name.trim() === "") return;
    void search(name.trim());
  }, [open, name]);

  const nearby = (found ?? []).filter(
    (p) => calculateDistance(lat, lon, p.lat, p.lon) <= NEARBY_KM
  );
  const rows = query.trim() === "" ? nearby : (found ?? []);

  const finish = async () => {
    if (!chosen) return;
    if (!withVisit) {
      setDone("linked");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      // Read the place afresh: a retry after a lost answer must not add a second visit.
      const fresh = await getPlace(chosen.id);
      const has = (fresh.visits ?? []).some((v) => {
        const at = visitTime(v);
        return at !== null && dayOf(at) === day;
      });
      if (has) {
        setDone("visitExists");
        return;
      }
      await createVisit(chosen.id, { visitedAt: day });
      setDone("visit");
    } catch (err: unknown) {
      logger.warn("TravTrack stop: visit could not be recorded", err);
      setFailure(trackErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1" data-testid="track-stop-to-places">
      <button
        type="button"
        className="underline t-caption self-start"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="track-stop-to-places-toggle"
        style={{ minHeight: height }}
      >
        {t("track:stop.toPlaces.open")}
      </button>
      {open && done === null && (
        <div className="flex flex-col gap-2">
          {chosen ? (
            <>
              <p className="t-body" data-testid="track-stop-to-places-chosen">
                {t("track:stop.toPlaces.chosen", { name: chosen.name })}
              </p>
              <label className="flex items-center gap-2 t-caption">
                <input
                  type="checkbox"
                  checked={withVisit}
                  onChange={(e) => setWithVisit(e.target.checked)}
                  data-testid="track-stop-to-places-visit"
                />
                {t("track:stop.toPlaces.withVisit", { day })}
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void finish()}
                data-testid="track-stop-to-places-finish"
                style={pillStyle(true, height)}
              >
                {t(busy ? "track:stop.toPlaces.saving" : "track:stop.toPlaces.finish")}
              </button>
            </>
          ) : (
            <>
              {rows.length > 0 && (
                <ul className="flex flex-col gap-1" data-testid="track-stop-to-places-list">
                  {rows.map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <span className="t-caption flex-1">
                        {p.name}
                        {p.city ? ` · ${p.city}` : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => setChosen(p)}
                        data-testid="track-stop-to-places-pick"
                        style={pillStyle(false, height)}
                      >
                        {t("track:stop.toPlaces.pick")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {found !== null && rows.length === 0 && (
                <p className="t-caption" data-testid="track-stop-to-places-none">
                  {t("track:stop.toPlaces.none")}
                </p>
              )}
              {lookupFailed && (
                <p className="t-caption" role="alert" style={{ color: token("bad") }}>
                  {t("track:stop.toPlaces.searchFailed")} {t(lookupFailed)}
                </p>
              )}
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (query.trim() !== "") void search(query.trim());
                }}
              >
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label={t("track:stop.toPlaces.searchLabel")}
                  data-testid="track-stop-to-places-query"
                  style={{ minHeight: height, color: token("text") }}
                />
                <button type="submit" style={pillStyle(false, height)}>
                  {t("track:stop.toPlaces.search")}
                </button>
              </form>
              <button
                type="button"
                onClick={() => setCreating(true)}
                data-testid="track-stop-to-places-new"
                style={pillStyle(true, height)}
              >
                {t("track:stop.toPlaces.new")}
              </button>
            </>
          )}
          {failure && (
            <p className="t-caption" role="alert" style={{ color: token("bad") }}>
              {t(failure)}
            </p>
          )}
        </div>
      )}
      {done && (
        <p className="t-caption" role="status" data-testid="track-stop-to-places-done">
          {t(`track:stop.toPlaces.done.${done}`, { name: chosen?.name ?? "" })}
        </p>
      )}
      {creating && (
        <PlaceFormModal
          place={null}
          initialName={name}
          initialLocation={{ lat, lon }}
          onClose={() => setCreating(false)}
          onSaved={(place) => {
            setCreating(false);
            setChosen(place);
          }}
        />
      )}
    </div>
  );
}
