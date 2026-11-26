import { useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import type { TravTrackDay } from "../../../lib/api/travtrack";
import { travTrackCleanupApi } from "../../../lib/api/travtrackCleanup";
import { logger } from "../../../lib/logger";
import InlineError from "../../../components/ui/InlineError";

/**
 * A day's cleanup (rc46 extras C): the smoothing switch for this day and for
 * all days — offered only where a low-scoring source is drawn — and the
 * stretches matched to roads, each labelled and with its undo. Raw points
 * never change; the labels say what is drawn instead.
 */
export default function TrackDayCleanup({
  day,
  onChanged,
}: {
  day: Pick<TravTrackDay, "date" | "cleanup" | "smoothedShown">;
  onChanged: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cleanup = day.cleanup;
  if (!cleanup || (!cleanup.smoothing.eligible && cleanup.matched.length === 0)) return null;

  const run = async (work: () => Promise<void>, failKey: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (e) {
      logger.warn("TravTrack cleanup change failed", e);
      setError(failKey);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1" data-testid="track-day-cleanup">
      {cleanup.smoothing.eligible && (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={cleanup.smoothing.on}
              disabled={busy}
              onChange={(e) =>
                void run(
                  () =>
                    travTrackCleanupApi.setSmoothing({
                      scope: "day",
                      date: day.date,
                      enabled: e.target.checked,
                    }),
                  "track:cleanup.error.saveFailed"
                )
              }
            />
            <span>{t("track:cleanup.smoothDay")}</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={cleanup.smoothing.global}
              disabled={busy}
              onChange={(e) =>
                void run(
                  () =>
                    travTrackCleanupApi.setSmoothing({
                      scope: "global",
                      enabled: e.target.checked,
                    }),
                  "track:cleanup.error.saveFailed"
                )
              }
            />
            <span>{t("track:cleanup.smoothAll")}</span>
          </label>
          <p className="t-caption">{t("track:cleanup.smoothHint")}</p>
        </>
      )}
      {cleanup.matched.map((m) => (
        <p key={m.id} className="t-caption flex flex-wrap items-center gap-2">
          <span>{t("track:cleanup.matchedLine", { provider: m.provider })}</span>
          <button
            type="button"
            className="underline"
            disabled={busy}
            onClick={() =>
              void run(() => travTrackCleanupApi.undo(m.id), "track:cleanup.error.undoFailed")
            }
          >
            {t("track:cleanup.undo")}
          </button>
        </p>
      ))}
      {error && <InlineError>{t(error)}</InlineError>}
    </div>
  );
}
