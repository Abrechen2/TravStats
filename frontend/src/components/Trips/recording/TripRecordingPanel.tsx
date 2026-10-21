import { useState, type JSX } from "react";
import ConfirmModal from "../../Training/ConfirmModal";
import { useTranslation } from "../../../hooks/useTranslation";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { JitterNote } from "../../tracks/JitterNote";
import { tripRecordingApi, type TripRecordingView } from "../../../lib/api/tripRecording";
import { DELETE_BUTTON_CLASS } from "../../../lib/deleteConfirm";
import { downloadBlob } from "../../../lib/export";
import { formatDayLong } from "../../../shared/time/calendar";
import { formatTimeValue } from "../../../shared/time/wire";

const CONTROL =
  "rounded-sm border border-(--color-border) px-3 py-1.5 text-xs hover:bg-(--bg-surface) disabled:opacity-40";

const DAY_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
};

interface Props {
  tripId: string;
  view: TripRecordingView | null;
  failed: boolean;
  /** `YYYY-MM-DD` on the trip's clock, or null for every day. */
  day: string | null;
  onDayChange: (day: string | null) => void;
  /** The recording was deleted — the map re-reads it. */
  onDeleted: () => void;
}

/**
 * The trip recording's line above the trip map (forgejo#316): what the phone
 * recorded, which day is shown, the GPX download and the delete. A trip with
 * no recording shows nothing at all; a recording that could not be loaded
 * says so instead of looking like none was made.
 */
export default function TripRecordingPanel({
  tripId,
  view,
  failed,
  day,
  onDayChange,
  onDeleted,
}: Props): JSX.Element | null {
  const { t, i18n } = useTranslation(["trips", "common"]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Touch sizing follows the pointer, not the width: an iPad is wide and
  // finger-operated, and the delete sat as a 30 px target beside the download.
  const coarse = useCoarsePointer();
  const touch = coarse ? { minHeight: "var(--ts-size-touch-min)" } : undefined;

  if (failed) {
    return (
      <p role="status" className="mb-2 text-sm text-(--text-muted)">
        {t("trips:recording.loadError")}
      </p>
    );
  }
  if (!view || view.summary.days.length === 0) return null;
  const { summary } = view;

  const download = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const file = await tripRecordingApi.downloadGpx(tripId);
      downloadBlob(file.blob, file.filename);
    } catch {
      setError(t("trips:recording.downloadError"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      await tripRecordingApi.remove(tripId);
      onDayChange(null);
      onDeleted();
    } catch {
      setError(t("trips:recording.deleteError"));
    } finally {
      setBusy(false);
    }
  };

  const span =
    summary.firstAt && summary.lastAt
      ? t("trips:recording.span", {
          first: formatTimeValue(summary.firstAt, i18n.language),
          last: formatTimeValue(summary.lastAt, i18n.language),
        })
      : null;

  return (
    <section
      aria-label={t("trips:recording.title")}
      className="mb-2 flex flex-col gap-2 text-sm"
      data-testid="trip-recording-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t("trips:recording.title")}</span>
        <select
          aria-label={t("trips:recording.dayFilter")}
          value={day ?? ""}
          onChange={(e) => onDayChange(e.target.value || null)}
          className="rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
          style={touch}
        >
          <option value="">{t("trips:recording.allDays")}</option>
          {summary.days.map((d) => (
            <option key={d.date} value={d.date}>
              {formatDayLong(d.date, i18n.language, DAY_OPTIONS)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={CONTROL}
          style={touch}
          disabled={busy}
          onClick={() => void download()}
        >
          {t("trips:recording.downloadGpx")}
        </button>
        <button
          type="button"
          className={CONTROL}
          style={touch}
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          {t("trips:recording.delete")}
        </button>
      </div>
      <p className="t-caption" data-testid="trip-recording-summary">
        {[
          t("trips:recording.points", { count: summary.pointCount }),
          span,
          // Paired devices are counted; an upload without one is named, never "0 devices".
          summary.devices.length > 0
            ? t("trips:recording.devices", { count: summary.devices.length })
            : null,
          summary.uploadedWithoutDevice ? t("trips:recording.uploadedWithoutDevice") : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <JitterNote jitterDropped={summary.jitterDropped} variant="line" />
      {error && (
        <p role="alert" className="text-sm text-(--danger)">
          {error}
        </p>
      )}
      <ConfirmModal
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void remove()}
        title={t("trips:recording.deleteConfirmTitle")}
        message={t("trips:recording.deleteConfirmMessage")}
        confirmText={t("trips:recording.delete")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />
    </section>
  );
}
