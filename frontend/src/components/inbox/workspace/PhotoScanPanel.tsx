import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../../hooks/useTranslation";
import { failureKey, immichApi, isImmichFailureKind } from "../../../lib/api/immich";
import { JobFailedError, JobLostError } from "../../../lib/api/jobs";
import { photoJourneysApi } from "../../../lib/api/photoJourneys";
import { logger } from "../../../lib/logger";
import { useToastStore } from "../../../store/toastStore";
import { Card } from "../../ui/Card";
import Button from "../../ui/Button";
import EmptyState from "../../ui/EmptyState";

const NS = "dataQuality:inbox.photoJourneys";
const SERVICES_PATH = "/settings/services?section=externalServices";

/**
 * The photo library's own controls, shown when the inbox is filtered to photo
 * suggestions: what the scan is, the nightly opt-in, and the scan itself.
 *
 * The scan is offered only when `GET /settings/immich` answers `hasAccess` —
 * the SAME resolver the scan calls first, so it is the answer and not an
 * approximation; the shared demo account gets "no library connected" rather
 * than a button that answers `scanned: false`. The status is asked only once
 * this panel is on screen: a request for a panel nobody opened is wasted.
 */
export default function PhotoScanPanel({
  empty,
  onScanned,
}: {
  /** No photo suggestion is waiting — the panel is then the empty state too. */
  empty: boolean;
  onScanned: () => Promise<void>;
}) {
  const { t } = useTranslation(["dataQuality", "common", "immich"]);
  const addToast = useToastStore((state) => state.addToast);
  // `null` until asked: neither "connected" nor "not", so neither the scan nor
  // the "connect it first" sentence is offered while it is unknown.
  const [hasImmich, setHasImmich] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await immichApi.getSettings();
        if (!cancelled) setHasImmich(status?.hasAccess === true);
      } catch (error) {
        // The suggestions themselves loaded; only the offer of a scan is lost,
        // and "no connection" on a failed request would be an unproven claim.
        logger.warn("Failed to read the Immich connection status:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scan = async (): Promise<void> => {
    setScanning(true);
    try {
      const result = await photoJourneysApi.scan();
      if (!result.scanned) {
        setHasImmich(false);
        addToast("info", t(`${NS}.messages.noImmich`));
        return;
      }
      addToast(
        "success",
        t(`${NS}.messages.scanned`, { created: result.created ?? 0, updated: result.updated ?? 0 })
      );
      await onScanned();
    } catch (error) {
      logger.error("Failed to scan for photo journeys:", error);
      if (error instanceof JobLostError) {
        // The scan may have finished and stored findings: show them, and say
        // the outcome is unknown rather than "failed".
        addToast("info", t(`${NS}.messages.scanOutcomeUnknown`));
        await onScanned();
      } else if (error instanceof JobFailedError && isImmichFailureKind(error.code)) {
        addToast(
          "error",
          t(`${NS}.errors.scanFailedImmich`, { reason: t(`immich:${failureKey(error.code)}`) })
        );
      } else {
        addToast("error", t(`${NS}.errors.scanFailed`));
      }
    } finally {
      setScanning(false);
    }
  };

  const scanButton = (
    <Button variant="primary" onClick={() => void scan()} disabled={scanning}>
      {scanning ? t(`${NS}.scanning`) : t(`${NS}.scan`)}
    </Button>
  );
  const settingsLink = (label: string) => (
    <Link to={SERVICES_PATH} className="font-semibold text-(--ts-accent)">
      {label}
    </Link>
  );

  return (
    <div className="space-y-3">
      <p className="t-caption">
        {t(`${NS}.description`)} {settingsLink(t(`${NS}.nightlyLink`))}
      </p>
      {!empty && hasImmich === true && <div className="flex justify-end">{scanButton}</div>}
      {empty && (
        <Card flush>
          {hasImmich === false ? (
            <EmptyState
              kind="unpaired"
              title={t(`${NS}.empty.noImmich.title`)}
              description={t(`${NS}.empty.noImmich.description`)}
              banner={t(`${NS}.empty.noImmich.banner`)}
              action={settingsLink(t(`${NS}.empty.noImmich.link`))}
            />
          ) : hasImmich === true ? (
            <EmptyState
              kind="nothing"
              title={t(`${NS}.empty.title`)}
              description={t(`${NS}.empty.description`)}
              action={scanButton}
            />
          ) : (
            <EmptyState
              kind="pending"
              title={t(`${NS}.empty.title`)}
              description={t(`${NS}.empty.description`)}
            />
          )}
        </Card>
      )}
    </div>
  );
}
