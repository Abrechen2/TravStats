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

import {
  createFromPhotoJourney,
  linkPhotoJourney,
  type PhotoJourneyCreated,
} from "./acceptPhotoJourney";
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
 *
 * That question is only asked once the tab is OPEN. The page mounts this
 * section with the inbox so the tab label can carry a count, which makes the
 * list fetch the price of the label — but the connection status is read by
 * nothing until somebody looks at the panel, and firing it on every inbox visit
 * spends a request on a screen nobody is looking at.
 */

export default function PhotoJourneysTab({
  onPendingCount,
  active = true,
}: {
  /** Reports how many suggestions are pending, for the tab label above. */
  onPendingCount?: (count: number) => void;
  /**
   * Whether the tab is the one on screen. Defaults to true so a caller that
   * renders the panel alone gets the whole thing.
   */
  active?: boolean;
} = {}): JSX.Element {
  const { t } = useTranslation(["dataQuality", "common"]);
  const addToast = useToastStore((state) => state.addToast);

  const [journeys, setJourneys] = useState<PhotoJourney[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  // A SET, not one id: with a single `busyId`, answering row B while row A was
  // still in flight re-enabled A's buttons — and A's buttons do the thing that
  // must not be done twice.
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  /**
   * What a click already created for a row, kept until the row is gone.
   *
   * The failure this exists for: `POST /trips` succeeded, the `PATCH` did not.
   * The row is still pending and the trip is already in the journal, so a
   * retry must NOT create a second one — it re-sends the link and nothing else.
   * Keyed by row id because two rows can be mid-answer at once.
   */
  const [createdByRow, setCreatedByRow] = useState<Record<string, PhotoJourneyCreated>>({});
  // `null` until the question has been asked — neither "connected" nor "not
  // connected", so the tab offers neither the scan nor the "connect it first"
  // sentence while it does not know.
  const [hasImmich, setHasImmich] = useState<boolean | null>(null);

  const markBusy = useCallback((id: string, busy: boolean): void => {
    // A new Set per change: mutating the held one would not re-render.
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

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
    // Only once the panel is on screen, and only once: `hasImmich` is the
    // answer, so a second visit to the tab does not ask again.
    if (!active || hasImmich !== null) return;
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
  }, [active, hasImmich]);

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

  /**
   * "Yes, this happened" — create, then link, and keep the two apart.
   *
   * A retry after a failed link re-uses what the first click created. Without
   * that, the second click created a second trip and the first message had
   * already said nothing was created: the row was still pending, because only
   * the PATCH had failed.
   */
  const handleAccept = async (journey: PhotoJourney): Promise<void> => {
    markBusy(journey.id, true);
    let created = createdByRow[journey.id];
    try {
      if (created === undefined) {
        const made = await createFromPhotoJourney(journey, photoJourneyLabel(journey));
        created = made;
        // Recorded BEFORE the link is attempted — that is the whole point.
        setCreatedByRow((current) => ({ ...current, [journey.id]: made }));
      }
    } catch (error) {
      logger.error("Failed to create from a photo journey:", error);
      addToast("error", t("dataQuality:inbox.photoJourneys.errors.acceptFailed"));
      markBusy(journey.id, false);
      return;
    }

    try {
      const photos = await linkPhotoJourney(journey.id, created);
      addToast("success", t(`dataQuality:inbox.photoJourneys.messages.accepted.${created.kind}`));
      if (photos?.kind === "linked" && photos.linked > 0) {
        addToast(
          "success",
          t("dataQuality:inbox.photoJourneys.messages.photosLinked", { count: photos.linked })
        );
      } else if (photos?.kind === "failed") {
        addToast("warning", t("dataQuality:inbox.photoJourneys.messages.photosNotLinked"));
      }
      // The row is answered and about to leave the list; its created entry goes
      // with it. A copy, then a delete on the copy — the held state is not
      // touched.
      setCreatedByRow((current) => {
        const next = { ...current };
        delete next[journey.id];
        return next;
      });
      await load();
    } catch (error) {
      logger.error("Failed to mark a photo journey accepted:", error);
      addToast(
        "error",
        created.kind === "none"
          ? t("dataQuality:inbox.photoJourneys.errors.acceptFailed")
          : // Names what DOES exist now, and that a retry only links it.
            t(`dataQuality:inbox.photoJourneys.errors.acceptLinkFailed.${created.kind}`)
      );
    } finally {
      markBusy(journey.id, false);
    }
  };

  const handleDismiss = async (journey: PhotoJourney): Promise<void> => {
    try {
      markBusy(journey.id, true);
      await photoJourneysApi.dismiss(journey.id);
      addToast("success", t("dataQuality:inbox.photoJourneys.messages.dismissed"));
      await load();
    } catch (error) {
      logger.error("Failed to dismiss a photo journey:", error);
      addToast("error", t("dataQuality:inbox.photoJourneys.errors.dismissFailed"));
    } finally {
      markBusy(journey.id, false);
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
              busy={busyIds.has(journey.id)}
              onAccept={() => void handleAccept(journey)}
              onDismiss={() => void handleDismiss(journey)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
