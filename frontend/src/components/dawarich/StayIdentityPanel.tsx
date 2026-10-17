import { lazy, Suspense, useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useInView } from "../../hooks/useInView";
import { dawarichStaysApi, type StayIdentity } from "../../lib/api/dawarichStays";
import { apiErrorMachineCode } from "../../lib/apiError";
import { logger } from "../../lib/logger";
import StayPlaceTypeLine from "./StayPlaceTypeLine";

// MapLibre is heavy; the inbox should not pay for it before a stay card shows.
const LocationMiniMap = lazy(() => import("../location/LocationMiniMap"));

/** Street level: the stay radius is 150 m. */
const MAP_ZOOM = 16;
const MAP_HEIGHT_PX = 180;

type Load =
  | { phase: "idle" | "loading" }
  | { phase: "error"; reason: "rateLimited" | "disabled" | "unavailable" }
  | { phase: "done"; identity: StayIdentity };

function reasonOf(error: unknown): "rateLimited" | "disabled" | "unavailable" {
  const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
  if (status === 429) return "rateLimited";
  return apiErrorMachineCode(error) === "STAY_SUGGESTIONS_DISABLED" ? "disabled" : "unavailable";
}

/**
 * Where a Dawarich stay was and what it probably was (forgejo#305): a map with
 * the stay's pin, the probable place, the address, the named places nearby and
 * — where Immich is connected and allowed — what the stay's photos say.
 *
 * Asked once, when the card first comes near the screen; the map is drawn only
 * while it is there, because a browser holds a handful of WebGL contexts and
 * the inbox can mount two hundred cards. Each source's failure is shown as
 * itself next to whatever the others answered.
 */
export default function StayIdentityPanel({
  stayId,
  lat,
  lon,
  onIdentity,
  onPickName,
}: {
  stayId: string;
  lat: number;
  lon: number;
  /** Called once the identity arrives, e.g. to prefill an untouched name. */
  onIdentity?: (identity: StayIdentity) => void;
  /** Present only while the finding can still be edited. */
  onPickName?: (name: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["trips", "location"]);
  const text = (key: string, values?: Record<string, unknown>) =>
    t(`trips:dawarichStays.identity.${key}`, values);
  const { ref, inView, seen } = useInView<HTMLDivElement>();
  const [load, setLoad] = useState<Load>({ phase: "idle" });
  const onIdentityRef = useRef(onIdentity);
  onIdentityRef.current = onIdentity;

  const ask = useCallback(async () => {
    setLoad({ phase: "loading" });
    try {
      const identity = await dawarichStaysApi.identity(stayId);
      setLoad({ phase: "done", identity });
      onIdentityRef.current?.(identity);
    } catch (error) {
      logger.warn("Stay identity request failed", error);
      setLoad({ phase: "error", reason: reasonOf(error) });
    }
  }, [stayId]);

  useEffect(() => {
    if (seen && load.phase === "idle") void ask();
  }, [seen, load.phase, ask]);

  return (
    <div ref={ref} className="my-3 grid gap-2" data-testid="stay-identity">
      {inView && (
        <Suspense fallback={<div style={{ height: MAP_HEIGHT_PX }} />}>
          <LocationMiniMap
            value={{ lat, lon }}
            initialViewState={{ latitude: lat, longitude: lon, zoom: MAP_ZOOM }}
            focusNonce={0}
            compact
            height={MAP_HEIGHT_PX}
            ariaLabel={text("mapLabel")}
            attributionLabel={t("location:attribution")}
          />
        </Suspense>
      )}
      {(load.phase === "idle" || load.phase === "loading") && (
        <p className="t-caption" role="status">
          {text("loading")}
        </p>
      )}
      {load.phase === "error" && (
        <p className="t-caption" role="alert">
          {text(`error.${load.reason}`)}{" "}
          {load.reason !== "disabled" && (
            <button type="button" className="underline" onClick={() => void ask()}>
              {text("retry")}
            </button>
          )}
        </p>
      )}
      {load.phase === "done" && (
        <IdentityDetails identity={load.identity} text={text} onPickName={onPickName} />
      )}
      {load.phase === "done" && load.identity.placeTypeAvailable && (
        <StayPlaceTypeLine stayId={stayId} />
      )}
    </div>
  );
}

type Text = (key: string, values?: Record<string, unknown>) => string;

function IdentityDetails({
  identity,
  text,
  onPickName,
}: {
  identity: StayIdentity;
  text: Text;
  onPickName?: (name: string) => void;
}): JSX.Element {
  const { probable, address, photos } = identity;
  const addressLine = address
    ? [address.address, address.city, address.country].filter(Boolean).join(", ")
    : null;
  return (
    <>
      {probable ? (
        <p>
          <span className="t-caption">{text("probable")}: </span>
          <strong>{probable.name}</strong>{" "}
          <span className="t-caption">
            ({text(`source.${probable.source}`)}
            {probable.photoSupported && probable.source !== "photos"
              ? `, ${text("photoSupported")}`
              : ""}
            )
          </span>
        </p>
      ) : (
        <p className="t-caption">{text("noProbable")}</p>
      )}
      {addressLine && <p className="t-caption">{addressLine}</p>}
      {identity.geocoder !== "ok" && (
        <p className="t-caption">{text(`geocoder.${identity.geocoder}`)}</p>
      )}
      {identity.candidates.length > 0 ? (
        <ul className="grid gap-1" aria-label={text("candidates")}>
          {identity.candidates.map((candidate) => (
            <li key={`${candidate.name}-${candidate.lat}-${candidate.lon}`} className="t-caption">
              {candidate.name}
              {candidate.type ? ` · ${candidate.type}` : ""} ·{" "}
              {text("distance", { meters: candidate.distanceM })}
              {candidate.photoCount
                ? ` · ${text("photoCount", { count: candidate.photoCount })}`
                : ""}
              {onPickName && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => onPickName(candidate.name)}
                  >
                    {text("useName")}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-caption">{text(`candidatesState.${identity.candidatesState}`)}</p>
      )}
      <PhotoLine photos={photos} text={text} />
    </>
  );
}

function PhotoLine({ photos, text }: { photos: StayIdentity["photos"]; text: Text }) {
  // Off and not configured are choices, not failures: nothing to report.
  if (photos.state === "off" || photos.state === "notConfigured") return null;
  if (photos.state !== "ok")
    return <p className="t-caption">{text(`photos.failed.${photos.state}`)}</p>;
  if (photos.count === 0) return <p className="t-caption">{text("photos.none")}</p>;
  const cities = photos.cities.map((city) => city.name).join(", ");
  return (
    <p className="t-caption">
      {text("photos.count", { count: photos.count })}
      {cities ? ` · ${text("photos.cities", { cities })}` : ""}
      {photos.truncated ? ` · ${text("photos.truncated")}` : ""}
    </p>
  );
}
