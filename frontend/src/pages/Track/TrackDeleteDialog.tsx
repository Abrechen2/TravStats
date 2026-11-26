import { useEffect, useState } from "react";
import type { JSX } from "react";
import ConfirmModal from "../../components/ui/ConfirmModal";
import { DELETE_BUTTON_CLASS } from "../../lib/deleteConfirm";
import { Field, Input } from "../../components/ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { trackErrorKey, travTrackApi } from "../../lib/api/travtrack";
import InlineError from "../../components/ui/InlineError";

interface Props {
  open: boolean;
  onClose: () => void;
  fromDay: string;
  toDay: string;
  /** The span was deleted; `count` positions went. */
  onDeleted: (count: number) => void;
}

type Preview =
  { kind: "counting" } | { kind: "count"; count: number } | { kind: "failed"; key: string };

/**
 * "Zeitraum löschen" (TravTrack plan T6): the days, then the count that will
 * go — read from the summary of exactly that span, the server's own preview —
 * and only then the delete. Flights and trips stay; the span stays deleted.
 */
export default function TrackDeleteDialog({
  open,
  onClose,
  fromDay,
  toDay,
  onDeleted,
}: Props): JSX.Element {
  const { t } = useTranslation(["track", "common"]);
  const [from, setFrom] = useState(fromDay);
  const [to, setTo] = useState(toDay);
  const [preview, setPreview] = useState<Preview>({ kind: "counting" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFrom(fromDay);
    setTo(toDay);
    setError(null);
  }, [open, fromDay, toDay]);

  const valid = from !== "" && to !== "" && from <= to;

  useEffect(() => {
    if (!open || !valid) return;
    let live = true;
    setPreview({ kind: "counting" });
    travTrackApi
      .summary({ fromDay: from, toDay: to })
      .then((s) => {
        if (live) setPreview({ kind: "count", count: s.pointCount });
      })
      .catch((err: unknown) => {
        logger.warn("TravTrack delete preview failed", err);
        if (live) setPreview({ kind: "failed", key: trackErrorKey(err) });
      });
    return () => {
      live = false;
    };
  }, [open, valid, from, to]);

  const remove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const deleted = await travTrackApi.deleteDays({ fromDay: from, toDay: to });
      onDeleted(deleted);
      onClose();
    } catch (err) {
      logger.warn("TravTrack delete failed", err);
      setError(trackErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmModal
      isOpen={open}
      onClose={onClose}
      onConfirm={() => void remove()}
      isLoading={busy}
      confirmDisabled={!valid || preview.kind !== "count"}
      title={t("track:delete.title")}
      message={t("track:delete.intro")}
      confirmText={t("track:delete.do")}
      confirmButtonClass={DELETE_BUTTON_CLASS}
      cancelText={t("common:buttons.cancel")}
    >
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <Field label={t("track:delete.from")} htmlFor="track-delete-from">
            <Input
              id="track-delete-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label={t("track:delete.to")} htmlFor="track-delete-to">
            <Input
              id="track-delete-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
        <p className="t-body" role="status" data-testid="track-delete-preview">
          {preview.kind === "counting"
            ? t("track:delete.counting")
            : preview.kind === "failed"
              ? t(preview.key)
              : preview.count === 0
                ? t("track:delete.previewNone")
                : t("track:delete.preview", { count: preview.count })}
        </p>
        {error && <InlineError>{t(error)}</InlineError>}
      </div>
    </ConfirmModal>
  );
}
