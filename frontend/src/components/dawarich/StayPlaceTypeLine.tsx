import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { dawarichStaysApi, type StayPlaceTypeResult } from "../../lib/api/dawarichStays";
import { logger } from "../../lib/logger";

type Load =
  { phase: "loading" } | { phase: "error" } | { phase: "done"; result: StayPlaceTypeResult };

/**
 * The model's guess at what kind of place a stay was (forgejo#305) — drawn
 * only when the account switched it on and the stay has nearby places to
 * classify. Every way it can end says so: a refusal names its gate, a failure
 * its cause; nothing turns into a missing line that reads like "no answer".
 */
export default function StayPlaceTypeLine({ stayId }: { stayId: string }): JSX.Element | null {
  const { t } = useTranslation(["trips"]);
  const text = (key: string, values?: Record<string, unknown>) =>
    t(`trips:dawarichStays.identity.placeType.${key}`, values);
  const [load, setLoad] = useState<Load>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    const ask = async () => {
      try {
        const result = await dawarichStaysApi.placeType(stayId);
        if (!cancelled) setLoad({ phase: "done", result });
      } catch (error) {
        logger.warn("Stay place type request failed", error);
        if (!cancelled) setLoad({ phase: "error" });
      }
    };
    void ask();
    return () => {
      cancelled = true;
    };
  }, [stayId]);

  if (load.phase === "loading") return <p className="t-caption">{text("loading")}</p>;
  if (load.phase === "error") return <p className="t-caption">{text("failed.unavailable")}</p>;
  const { result } = load;
  if (result.state === "off" || result.state === "noCandidates") return null;
  if (result.state === "refused")
    return <p className="t-caption">{text(`refused.${result.refusal}`)}</p>;
  if (result.state === "failed")
    return <p className="t-caption">{text(`failed.${result.failure}`)}</p>;
  return (
    <p className="t-caption">
      {text("label")}: <strong>{text(`types.${result.type}`)}</strong>
      {result.provider.isCloud && result.provider.host
        ? ` · ${text("viaCloud", { host: result.provider.host })}`
        : ""}
    </p>
  );
}
