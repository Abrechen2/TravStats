import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { token } from "../../../components/ui/tokens";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useTranslation } from "../../../hooks/useTranslation";
import { trackErrorKey } from "../../../lib/api/travtrack";
import {
  travTrackLegsApi,
  type TravTrackStop,
  type TravTrackStopIdentity,
} from "../../../lib/api/travtrackLegs";
import { logger } from "../../../lib/logger";
import { loadStopIdentity } from "../../../lib/travtrackStopIdentity";
import { pillStyle } from "./trackMapStyle";

/**
 * The name of a stop (spec 2026-11-03-travtrack-legs, "As built — stop
 * places"): the name the owner accepted, or — fetched lazily once the stop is
 * on screen — the probable place with "Übernehmen" and "Andere Vorschläge".
 * Accepting is stored on the server. A failed lookup is shown as itself: a
 * request that failed, a geocoder that was down and a place that is simply
 * not there are three different sentences.
 */

type Lookup =
  | { state: "idle" | "loading" }
  | { state: "failed" }
  | { state: "ready"; identity: TravTrackStopIdentity };

function useVisible<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const node = ref.current;
    if (seen || !node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen];
}

export default function TrackStopPlace({
  stop,
  onChanged,
}: {
  stop: TravTrackStop;
  /** Called after a name was stored or removed, so the day can be read again. */
  onChanged?: () => void;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const coarse = useCoarsePointer();
  const [ref, visible] = useVisible<HTMLDivElement>();
  const [accepted, setAccepted] = useState<string | null | undefined>(undefined);
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const [others, setOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // `undefined`: the server's word (`stop.place`) stands; otherwise what was just stored.
  const name = accepted === undefined ? (stop.place?.name ?? null) : accepted;
  // The server's word wins again once the day was read afresh.
  const serverName = stop.place?.name ?? null;
  useEffect(() => setAccepted(undefined), [serverName]);

  const ask = useCallback(() => {
    setLookup({ state: "loading" });
    loadStopIdentity(stop).then(
      (identity) => setLookup({ state: "ready", identity }),
      (err: unknown) => {
        logger.warn("TravTrack stop place could not be looked up", err);
        setLookup({ state: "failed" });
      }
    );
  }, [stop]);

  useEffect(() => {
    if (name === null && visible) ask();
  }, [name, visible, ask]);

  const store = async (place: { name: string; lat?: number; lon?: number } | null) => {
    setBusy(true);
    setFailure(null);
    try {
      const saved = await travTrackLegsApi.setStopPlace(
        { fromMs: stop.fromMs, untilMs: stop.untilMs },
        place
      );
      setAccepted(saved.place?.name ?? null);
      setOthers(false);
      onChanged?.();
    } catch (err: unknown) {
      logger.warn("TravTrack stop place could not be stored", err);
      const key = trackErrorKey(err);
      setFailure(key);
      // The stop is gone (the points changed): read the day again, as the leg editor does.
      if (key === "track:errors.stopGone") onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const height = coarse ? 44 : 36;
  const identity = lookup.state === "ready" ? lookup.identity : null;
  const probable = identity?.probable ?? null;
  const known = identity?.known[0];
  // The owner's own places first (all of them, not only the probable one), then the geocoder's.
  const options = identity
    ? [
        ...identity.known.map((k) => ({
          name: k.name,
          lat: k.lat,
          lon: k.lon,
          distanceM: k.distanceM,
        })),
        ...identity.candidates.filter(
          (c) => !identity.known.some((k) => k.name.toLowerCase() === c.name.toLowerCase())
        ),
      ]
    : [];
  const candidatePlace = (c: { name: string; lat: number; lon: number }) => ({
    name: c.name,
    lat: c.lat,
    lon: c.lon,
  });

  let body: JSX.Element;
  if (name !== null) {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <span className="t-body" style={{ fontWeight: 600 }} data-testid="track-stop-place-name">
          {t("track:stop.place.accepted", { name })}
        </span>
        <button
          type="button"
          className="underline t-caption"
          disabled={busy}
          onClick={() => void store(null)}
          data-testid="track-stop-place-remove"
          style={{ minHeight: height }}
        >
          {t("track:stop.place.remove")}
        </button>
      </div>
    );
  } else if (lookup.state === "failed") {
    body = (
      <p className="t-caption" role="alert" style={{ color: token("bad") }}>
        {t("track:stop.place.failed")}{" "}
        <button type="button" className="underline" onClick={ask} style={{ minHeight: height }}>
          {t("track:stop.place.retry")}
        </button>
      </p>
    );
  } else if (!identity) {
    body = (
      <p className="t-caption" data-testid="track-stop-place-loading">
        {t("track:stop.place.loading")}
      </p>
    );
  } else {
    const down = identity.geocoder === "degraded" || identity.candidatesState === "degraded";
    body = (
      <div className="flex flex-col gap-1">
        {probable ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-body" data-testid="track-stop-place-probable">
              {t("track:stop.place.probable", { name: probable.name })}
              {probable.source === "known" ? ` · ${t("track:stop.place.known")}` : ""}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void store(
                  known && probable.source === "known"
                    ? candidatePlace(known)
                    : {
                        name: probable.name,
                        ...(identity.candidates[0]?.name === probable.name
                          ? candidatePlace(identity.candidates[0])
                          : {}),
                      }
                )
              }
              data-testid="track-stop-place-accept"
              style={pillStyle(true, height)}
            >
              {t(busy ? "track:stop.place.accepting" : "track:stop.place.accept")}
            </button>
          </div>
        ) : (
          <p className="t-caption" data-testid="track-stop-place-none">
            {t(
              identity.lookup === "off"
                ? "track:stop.place.suggestionsOff"
                : down
                  ? "track:stop.place.unavailable"
                  : "track:stop.place.none"
            )}
          </p>
        )}
        {probable && down && (
          <p className="t-caption" data-testid="track-stop-place-degraded">
            {t("track:stop.place.partial")}
          </p>
        )}
        {options.length > 0 && (
          <>
            <button
              type="button"
              className="underline t-caption self-start"
              aria-expanded={others}
              onClick={() => setOthers((o) => !o)}
              data-testid="track-stop-place-others"
              style={{ minHeight: height }}
            >
              {t(others ? "track:stop.place.hideOthers" : "track:stop.place.others")}
            </button>
            {others && (
              <ul className="flex flex-col gap-1" data-testid="track-stop-place-candidates">
                {options.map((c) => (
                  <li key={`${c.name}-${c.lat}-${c.lon}`} className="flex items-center gap-2">
                    <span className="t-caption flex-1">
                      {c.name} · {t("track:stop.place.distance", { m: c.distanceM })}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void store(candidatePlace(c))}
                      data-testid="track-stop-place-candidate-accept"
                      style={pillStyle(false, height)}
                    >
                      {t("track:stop.place.accept")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="flex flex-col gap-1" data-testid="track-stop-place">
      {body}
      {failure && (
        <p className="t-caption" role="alert" style={{ color: token("bad") }}>
          {t(failure)}
        </p>
      )}
    </div>
  );
}
