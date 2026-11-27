import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { useReceivedTripsStore } from "../../store/receivedTripsStore";
import type { ReceivedTripItem } from "../../types/sharing";
import { Button } from "../ui";
import InlineError from "../ui/InlineError";

const NS = "sharing:receivedBanner";
/** More than this folds into "und N weitere". */
const SHOWN = 3;

/**
 * The dashboard says when a trip was shared with the reader (2026-11-24: a trip arrived on a
 * father's server, accepted by his consent, and he never noticed). Until seen: each trip that
 * arrived (and whether the consent took it without a question) and each offer waiting for an
 * answer. "Gesehen" marks the arrived ones read; an offer stays until it is answered.
 */
/**
 * Over the dashboard map the banner floats in the map's chrome band (UAT 2026-11-27: in the page
 * flow it sat BEHIND the globe, which fills its container absolutely). Same band as the
 * "+ hinzufügen" button and "Als Nächstes" (z 30), below the open domain filter (35).
 */
export const OVER_MAP_Z = 30;

export default function ReceivedTripsBanner({
  overMap = false,
}: {
  /** On the dashboard: float above the map instead of sitting in the page flow. */
  overMap?: boolean;
} = {}): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const items = useReceivedTripsStore((s) => s.items);
  const load = useReceivedTripsStore((s) => s.load);
  const markSeen = useReceivedTripsStore((s) => s.markSeen);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  if (items.length === 0) return null;
  const from = (item: ReceivedTripItem): string =>
    item.from.origin
      ? `${item.from.displayName} (${item.from.origin.replace(/^https?:\/\//, "")})`
      : item.from.displayName;
  const dismiss = async (): Promise<void> => {
    setFailed(false);
    try {
      await markSeen();
    } catch (error) {
      logger.error("Failed to mark shared trips as seen:", error);
      setFailed(true);
    }
  };

  return (
    <div
      role="status"
      data-testid="received-trips-banner"
      className={`${overMap ? "" : "mb-4 "}flex flex-col rounded-md text-sm`}
      style={{
        ...(overMap
          ? {
              position: "absolute",
              top: 16,
              left: 16,
              zIndex: OVER_MAP_Z,
              maxWidth: "min(480px, calc(100% - 32px))",
            }
          : {}),
        gap: 6,
        padding: "10px 14px",
        border: "1px solid var(--ts-accent)",
        background: "var(--ts-surface2)",
      }}
    >
      {items.slice(0, SHOWN).map((item) => (
        <div key={item.id} className="flex flex-wrap items-center" style={{ gap: 8 }}>
          <span style={{ fontWeight: 600 }}>
            {t(`${NS}.${item.kind === "offer" ? "offered" : "shared"}`, {
              name: from(item),
              trip: item.tripName,
            })}
          </span>
          {item.autoAccepted && <span className="t-caption">{t(`${NS}.autoAccepted`)}</span>}
          {item.tripId ? (
            <Link to={`/trips/${item.tripId}`}>{t(`${NS}.open`)}</Link>
          ) : (
            <Link to="/pending-updates">{t(`${NS}.answer`)}</Link>
          )}
        </div>
      ))}
      {items.length > SHOWN && (
        <span className="t-caption">{t(`${NS}.more`, { count: items.length - SHOWN })}</span>
      )}
      {failed && <InlineError tone="warning">{t(`${NS}.seenFailed`)}</InlineError>}
      {items.some((i) => i.kind === "shared") && (
        <div>
          <Button onClick={() => void dismiss()}>{t(`${NS}.seen`)}</Button>
        </div>
      )}
    </div>
  );
}
