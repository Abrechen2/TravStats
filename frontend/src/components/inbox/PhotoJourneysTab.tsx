import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { immichApi } from "../../lib/api/immich";
import { photoJourneysApi } from "../../lib/api/photoJourneys";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import type { PhotoJourney } from "../../types/photoJourney";
import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";

import { acceptPhotoJourney } from "./acceptPhotoJourney";
import PhotoJourneyCard from "./PhotoJourneyCard";
import { photoJourneyLabel } from "./photoJourneyLabel";

/**
 * The "Foto-Reisen" half of the Posteingang — what the photo library knows that
 * the journal does not (forgejo#94, point 1).
 *
 * The scan has been on the server since 2026-09-05 and NOTHING on the web read
 * its rows; this tab is the consumer. It owns its own fetching, its own errors
 * and its own empty states, the way `DataQualityFlagsSection` does, so the two
 * tabs beside it behave exactly as they did.
 *
 * ## Why it asks Immich whether a scan is possible
 *
 * The scan button is offered only when `GET /settings/immich` answers
 * `hasAccess`. That field is `getImmichConnection(userId) !== null` — the SAME
 * resolver `scanPhotoJourneys` calls before it does anything else, so it is not
 * an approximation of "would a scan reach a library", it is the answer. It also
 * covers the shared demo account for free: the resolver returns null for it on
 * purpose, and a demo visitor therefore sees "no library connected" rather than
 * a button that answers `scanned: false`. An account with no connection gets the
 * sentence and a way to Settings instead — never a scan that must fail.
 */

export default function PhotoJourneysTab({
  onPendingCount,
}: {
  /** Reports how many suggestions are pending, for the tab label above. */
  onPendingCount?: (count: number) => void;
} = {}): JSX.Element {
  const { t } = useTranslation(["dataQuality", "common"]);
  const addToast = useToastStore((state) => state.addToast);

  const [journeys, setJourneys] = useState<PhotoJourney[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // `null` until the question has been asked — neither "connected" nor "not
  // connected", so the tab offers neither the scan nor the "connect it first"
  // sentence while it does not know.
  const [hasImmich, setHasImmich] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await photoJourneysApi.list("pending");
      setJourneys(rows);
      onPendingCount?.(rows.length);
    } catch (error) {
      logger.error("Failed to load photo journeys:", error);
      addToast("error", t("dataQuality:inbox.photoJourneys.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [addToast, t, onPendingCount]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await immichApi.getSettings();
        if (!cancelled) setHasImmich(status?.hasAccess === true);
      } catch (error) {
        // No toast: the rows are the point of this tab and they loaded. What is
        // lost is the offer of a scan, and claiming "no connection" on a failed
        // request would be an assertion this side has not established.
        logger.warn("Failed to read the Immich connection status:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleScan = async (): Promise<void> => {
    try {
      setScanning(true);
      const result = await photoJourneysApi.scan();
      if (!result.scanned) {
        // The server answered 200 and did nothing, because there is no library.
        // Say that, and stop offering the button.
        setHasImmich(false);
        addToast("info", t("dataQuality:inbox.photoJourneys.messages.noImmich"));
        return;
      }
      addToast(
        "success",
        t("dataQuality:inbox.photoJourneys.messages.scanned", {
          created: result.created ?? 0,
          updated: result.updated ?? 0,
        })
      );
      await load();
    } catch (error) {
      logger.error("Failed to scan for photo journeys:", error);
      addToast("error", t("dataQuality:inbox.photoJourneys.errors.scanFailed"));
    } finally {
      setScanning(false);
    }
  };

  const handleAccept = async (journey: PhotoJourney): Promise<void> => {
    try {
      setBusyId(journey.id);
      const created = await acceptPhotoJourney(journey, photoJourneyLabel(journey));
      addToast("success", t(`dataQuality:inbox.photoJourneys.messages.accepted.${created}`));
      await load();
    } catch (error) {
      logger.error("Failed to accept a photo journey:", error);
      addToast("error", t("dataQuality:inbox.photoJourneys.errors.acceptFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = async (journey: PhotoJourney): Promise<void> => {
    try {
      setBusyId(journey.id);
      await photoJourneysApi.dismiss(journey.id);
      addToast("success", t("dataQuality:inbox.photoJourneys.messages.dismissed"));
      await load();
    } catch (error) {
      logger.error("Failed to dismiss a photo journey:", error);
      addToast("error", t("dataQuality:inbox.photoJourneys.errors.dismissFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const scanButton = (
    <Button variant="primary" onClick={() => void handleScan()} disabled={scanning}>
      {scanning
        ? t("dataQuality:inbox.photoJourneys.scanning")
        : t("dataQuality:inbox.photoJourneys.scan")}
    </Button>
  );

  return (
    <section>
      <p className="t-caption mb-4">{t("dataQuality:inbox.photoJourneys.description")}</p>

      {/* The scan sits above the list only when there IS a list — with none, it
          is the empty state's one way out, and two of the same button on one
          screen is one button too many. */}
      {hasImmich === true && journeys.length > 0 && (
        <div className="mb-5 flex justify-end">{scanButton}</div>
      )}

      {loading ? (
        <div
          className="rounded-[var(--ts-radius-card)] p-6 text-center"
          style={{ background: "var(--ts-surface)", border: "1px solid var(--ts-border)" }}
        >
          <span className="t-caption">{t("common:loading.default")}</span>
        </div>
      ) : journeys.length === 0 ? (
        <div
          className="rounded-[var(--ts-radius-card)]"
          style={{ background: "var(--ts-surface)", border: "1px solid var(--ts-border)" }}
        >
          {hasImmich === false ? (
            /* `unpaired`, not `nothing` and never red: nothing is broken, a
               step is missing — and the step is on another page, so the way out
               is a link there rather than an action here. */
            <EmptyState
              kind="unpaired"
              title={t("dataQuality:inbox.photoJourneys.empty.noImmich.title")}
              description={t("dataQuality:inbox.photoJourneys.empty.noImmich.description")}
              banner={t("dataQuality:inbox.photoJourneys.empty.noImmich.banner")}
              action={
                <Link
                  to="/settings/services?section=externalServices"
                  style={{ color: "var(--ts-accent)", fontWeight: 600 }}
                >
                  {t("dataQuality:inbox.photoJourneys.empty.noImmich.link")}
                </Link>
              }
            />
          ) : hasImmich === true ? (
            /* `nothing`, which owes the reader its one way out — the scan. */
            <EmptyState
              kind="nothing"
              title={t("dataQuality:inbox.photoJourneys.empty.title")}
              description={t("dataQuality:inbox.photoJourneys.empty.description")}
              action={scanButton}
            />
          ) : (
            /* The connection status has not answered yet. `pending`, because
               there is no way out to offer until it has, and `nothing` without
               an action is the dead end that kind forbids. */
            <EmptyState
              kind="pending"
              title={t("dataQuality:inbox.photoJourneys.empty.title")}
              description={t("dataQuality:inbox.photoJourneys.empty.description")}
            />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {journeys.map((journey) => (
            <PhotoJourneyCard
              key={journey.id}
              journey={journey}
              label={photoJourneyLabel(journey)}
              busy={busyId === journey.id}
              onAccept={() => void handleAccept(journey)}
              onDismiss={() => void handleDismiss(journey)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
