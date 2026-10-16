import { useEffect, useState } from "react";
import Button from "../ui/Button";
import DetailSection from "../ui/DetailSection";
import { useTranslation } from "../../hooks/useTranslation";
import { ferryApi } from "../../lib/api/ferry";
export interface FerryAisResult {
  status: "ok" | "notConfigured" | "noSignal" | "unavailable" | "busy";
  position: {
    mmsi: string;
    vesselName: string | null;
    lat: number;
    lon: number;
    speedKnots: number | null;
    courseDegrees: number | null;
    receivedAt: string;
    observedAt: string | null;
  } | null;
}
export function FerryLivePosition({
  id,
  boundMmsi = null,
}: {
  id: string;
  /** The crossing's vessel. The server reads only this one once it is set. */
  boundMmsi?: string | null;
}) {
  const { t, i18n } = useTranslation(["ferry"]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [bound, setBound] = useState(boundMmsi);
  const [mmsi, setMmsi] = useState(boundMmsi ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FerryAisResult | null>(null);
  useEffect(() => {
    let live = true;
    void ferryApi
      .liveAvailability()
      .then((r) => {
        if (live) setConfigured(r.configured);
      })
      .catch(() => {
        if (live) setResult({ status: "unavailable", position: null });
      });
    return () => {
      live = false;
    };
  }, []);
  const read = async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const answer = await ferryApi.livePosition(id, mmsi);
      setResult(answer);
      // The first answered MMSI is now the crossing's; another would be refused.
      if (answer.status === "ok" && answer.position) setBound(answer.position.mmsi);
    } catch {
      setResult({ status: "unavailable", position: null });
    } finally {
      setBusy(false);
    }
  };
  const p = result?.position;
  return (
    <DetailSection title={t("ferry:live.title")}>
      <p className="t-caption">{t("ferry:live.hint")}</p>
      {configured === false ? (
        <p className="text-sm">{t("ferry:live.notConfigured")}</p>
      ) : (
        <>
          <label className="block text-sm">
            {t("ferry:live.mmsi")}
            <input
              className="mt-1 w-full rounded-md border border-border bg-(--bg-surface) px-3 py-3"
              value={mmsi}
              inputMode="numeric"
              maxLength={9}
              pattern="[0-9]{9}"
              disabled={busy}
              readOnly={bound !== null}
              aria-describedby={bound !== null ? `${id}-mmsi-bound` : undefined}
              onChange={(e) => {
                setMmsi(e.target.value);
                setResult(null);
              }}
            />
          </label>
          {bound !== null && (
            <p id={`${id}-mmsi-bound`} className="t-caption">
              {t("ferry:live.bound")}
            </p>
          )}
          <Button
            disabled={!configured || busy || !/^\d{9}$/.test(mmsi)}
            onClick={() => void read()}
          >
            {t(busy ? "ferry:live.waiting" : "ferry:live.read")}
          </Button>
        </>
      )}
      {result && !p && (
        <p role="status" className="text-sm">
          {t(`ferry:live.${result.status}`)}
        </p>
      )}
      {p && (
        <div role="status" className="space-y-2 text-sm">
          <p>
            {p.vesselName ?? p.mmsi} · {p.mmsi}
          </p>
          <p>
            {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
            {p.speedKnots !== null ? ` · ${p.speedKnots} kn` : ""}
          </p>
          <p className="t-caption">
            {t("ferry:live.received", {
              time: new Date(p.receivedAt).toLocaleString(i18n.language, {
                timeZone: "UTC",
                timeZoneName: "short",
              }),
            })}
          </p>
          <p className="t-caption">
            {p.observedAt
              ? t("ferry:live.observed", {
                  time: new Date(p.observedAt).toLocaleString(i18n.language, {
                    timeZone: "UTC",
                    timeZoneName: "short",
                  }),
                })
              : t("ferry:live.ageUnknown")}
          </p>
          <a
            href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=12/${p.lat}/${p.lon}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-(--accent) underline"
          >
            {t("ferry:live.map")}
          </a>
          <p className="t-caption">AISStream · AIS</p>
        </div>
      )}
    </DetailSection>
  );
}
