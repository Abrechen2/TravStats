import { useEffect, useState } from "react";
import type { JSX } from "react";
import DetailSection from "../ui/DetailSection";
import { useTranslation } from "../../hooks/useTranslation";
import { vesselApi, type VesselKind, type VesselStatus } from "../../lib/api/vessel";

/**
 * The ship behind a crossing or a cruise (2026-11-22): which one the server
 * found, from where, and — during the voyage — its last AIS position. Nothing
 * here is typed: the server resolves the ship from its name and records the
 * track itself. Every state says what it is; out of terrestrial AIS range is
 * the common case at sea and is named, never an empty panel.
 */
export function VesselLiveStatus({
  kind,
  id,
  reloadKey = 0,
  onLoaded,
}: {
  kind: VesselKind;
  id: string;
  /** Bumped by the page after "Schiff zuordnen …" so the panel reads again. */
  reloadKey?: number;
  onLoaded?: (status: VesselStatus) => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["ferry"]);
  const [status, setStatus] = useState<VesselStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    const load = async () => {
      try {
        const answer = await vesselApi.status(kind, id);
        if (!live) return;
        setStatus(answer);
        onLoaded?.(answer);
      } catch (error) {
        console.warn("vessel status failed", error);
        if (live) setFailed(true);
      }
    };
    void load();
    return () => {
      live = false;
    };
    // onLoaded is a page callback; a new identity must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, reloadKey]);

  const time = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { timeZone: "UTC", timeZoneName: "short" });
  const fix = status?.lastFix ?? null;

  return (
    <DetailSection title={t("ferry:vessel.title")}>
      {failed && (
        <p role="alert" className="text-sm text-(--ts-bad)">
          {t("ferry:vessel.loadFailed")}
        </p>
      )}
      {status && (
        <div className="space-y-2 text-sm" data-testid="vessel-status">
          {status.mmsi ? (
            <>
              <p>
                {t("ferry:vessel.ship", { name: status.vesselName ?? status.mmsi })} ·{" "}
                {t("ferry:vessel.mmsi", { mmsi: status.mmsi })}
              </p>
              <p className="t-caption">
                {t(`ferry:vessel.source.${status.source ?? "legacy"}`)}
                {status.confidence === "medium" ? ` – ${t("ferry:vessel.medium")}` : ""}
              </p>
            </>
          ) : (
            <p role="status">{t(`ferry:vessel.reason.${status.reason ?? "notFound"}`)}</p>
          )}
          {status.mmsi && status.signal !== "ok" && (
            <p role="status" data-testid="vessel-signal">
              {t(`ferry:vessel.signal.${status.signal}`)}
            </p>
          )}
          {fix && (
            <div role="status" className="space-y-1">
              <p>
                {t("ferry:vessel.lastFix", { lat: fix.lat.toFixed(5), lon: fix.lon.toFixed(5) })}
                {fix.speedKnots !== null
                  ? ` · ${t("ferry:vessel.speed", { knots: fix.speedKnots })}`
                  : ""}
              </p>
              <p className="t-caption">
                {t("ferry:vessel.lastFixAt", { time: time(fix.observedAt) })}
              </p>
              <a
                href={`https://www.openstreetmap.org/?mlat=${fix.lat}&mlon=${fix.lon}#map=10/${fix.lat}/${fix.lon}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-(--accent) underline"
              >
                {t("ferry:vessel.map")}
              </a>
            </div>
          )}
          {status.track && (
            <p className="t-caption">
              {t("ferry:vessel.track", {
                count: status.track.coordinates.length,
                km: status.track.distanceKm.toLocaleString(i18n.language),
              })}
              {status.track.coversJourney ? ` ${t("ferry:vessel.trackCovers")}` : ""}
            </p>
          )}
          <p className="t-caption">AIS · AISStream · Wikidata</p>
        </div>
      )}
    </DetailSection>
  );
}
