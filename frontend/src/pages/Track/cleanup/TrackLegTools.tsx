import { useEffect, useState, type JSX } from "react";
import { token } from "../../../components/ui/tokens";
import { useServiceUseConfirm } from "../../../components/ExternalServices/useServiceUseConfirm";
import { useTranslation } from "../../../hooks/useTranslation";
import { UseCancelledError, withUseConsent } from "../../../lib/api/serviceUse";
import type { TravTrackLeg } from "../../../lib/api/travtrackLegs";
import { travTrackCleanupApi } from "../../../lib/api/travtrackCleanup";
import { logger } from "../../../lib/logger";
import { localDay } from "../../../shared/time/zone";
import RoadtripFromTrackDialog from "../roadtrip/RoadtripFromTrackDialog";
import { matchFailureKey } from "./matchFailure";

/** Modes a road can explain; a flight, a train or a boat is never matched to a road. */
const ROAD_MODES: ReadonlySet<string> = new Set(["car", "bus", "cycle", "unknown"]);

/** One availability answer per page view. */
let availability: Promise<boolean> | null = null;
export function resetMapMatchingAvailability(): void {
  availability = null;
}
function matchingAvailable(): Promise<boolean> {
  availability ??= (async () => {
    try {
      return (await travTrackCleanupApi.availability()).available;
    } catch (error) {
      logger.warn("Map matching availability could not be read", error);
      availability = null;
      return false;
    }
  })();
  return availability;
}

/**
 * The leg card's two takeovers (rc46 extras A and C2): "Als Roadtrip
 * übernehmen" for this leg, and "An Straßen anpassen" through the admin's
 * own router — offered only while the server has one, and only for a mode a
 * road can explain. Matching asks for the confirmation first; every failure
 * is said as itself.
 */
export default function TrackLegTools({
  leg,
  zone,
  onChanged,
}: {
  leg: TravTrackLeg;
  zone: string;
  onChanged: () => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const confirm = useServiceUseConfirm();
  const [roadtrip, setRoadtrip] = useState(false);
  const [canMatch, setCanMatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; key: string } | null>(null);
  const roadMode = ROAD_MODES.has(leg.mode);

  useEffect(() => {
    let live = true;
    const check = async () => {
      // Only a "yes" changes anything: the button starts hidden.
      if ((await matchingAvailable()) && live) setCanMatch(true);
    };
    if (roadMode) void check();
    return () => {
      live = false;
    };
  }, [roadMode]);

  const match = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await withUseConsent(
        (confirmation) =>
          travTrackCleanupApi.match({ fromMs: leg.fromMs, untilMs: leg.untilMs }, confirmation),
        confirm.ask
      );
      setMessage({ kind: "ok", key: "track:cleanup.matched" });
      await onChanged();
    } catch (error) {
      if (!(error instanceof UseCancelledError)) {
        logger.warn("Map matching failed", error);
        setMessage({ kind: "error", key: matchFailureKey(error) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1" data-testid="track-leg-tools">
      {confirm.dialog}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="underline" onClick={() => setRoadtrip(true)}>
          {t("track:roadtrip.open")}
        </button>
        {roadMode && canMatch && (
          <button
            type="button"
            className="underline"
            disabled={busy}
            onClick={() => void match()}
            data-testid="track-leg-match"
          >
            {busy ? t("track:cleanup.matching") : t("track:cleanup.match")}
          </button>
        )}
      </div>
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className="t-caption"
          style={message.kind === "error" ? { color: token("bad") } : undefined}
        >
          {t(message.key)}
        </p>
      )}
      {roadtrip && (
        <RoadtripFromTrackDialog
          span={{ fromMs: leg.fromMs, untilMs: leg.untilMs }}
          days={{ fromDay: localDay(leg.fromMs, zone), toDay: localDay(leg.untilMs, zone) }}
          onClose={() => setRoadtrip(false)}
        />
      )}
    </div>
  );
}
