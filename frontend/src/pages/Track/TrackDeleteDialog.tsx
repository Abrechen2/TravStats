import { useEffect, useState } from "react";
import type { JSX } from "react";
import Dialog from "../../components/ui/Dialog";
import Button from "../../components/ui/Button";
import { Field, Input } from "../../components/ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { trackErrorKey, travTrackApi } from "../../lib/api/travtrack";
import { token } from "../../components/ui/tokens";

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
    <Dialog
      open={open}
      onClose={onClose}
      title={t("track:delete.title")}
      busy={busy}
      dismissLabel={t("common:buttons.cancel")}
      action={
        <Button
          variant="danger"
          disabled={!valid || busy || preview.kind !== "count"}
          onClick={() => void remove()}
        >
          {t("track:delete.do")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="t-caption">{t("track:delete.intro")}</p>
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
        {error && (
          <p className="t-body" role="alert" style={{ color: token("bad") }}>
            {t(error)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
