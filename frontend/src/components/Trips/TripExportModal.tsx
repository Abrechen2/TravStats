import { useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { downloadBlob } from "../../lib/export";
import { tripExchangeApi, type TripExportOptions } from "../../lib/api/tripExchange";

/**
 * "Reise exportieren" (spec 2026-10-09 S3): the trip as a `.travstats` file.
 * Every extra is off until ticked, and the dialog says plainly that the file
 * leaves the server — whoever receives it can read all of it. A failure is
 * shown in the dialog as itself, and the dialog stays open.
 */
export interface TripExportModalProps {
  tripId: string;
  onClose: () => void;
}

const OPTIONS: Array<keyof TripExportOptions> = ["documents", "photos", "private"];

function failureKey(err: unknown): string {
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  if (status === 404) return "notFound";
  if (status === 429) return "rateLimited";
  return "failed";
}

export function TripExportModal({ tripId, onClose }: TripExportModalProps): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const [options, setOptions] = useState<TripExportOptions>({
    documents: false,
    photos: false,
    private: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleDownload = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const file = await tripExchangeApi.download(tripId, options);
      downloadBlob(file.blob, file.filename);
      setDone(true);
    } catch (err) {
      logger.error("TripExportModal: export failed", err);
      setError(t(`trips:export.errors.${failureKey(err)}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={t("trips:export.title")}
      maxWidth={560}
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            {t("common:buttons.close")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleDownload()}
            disabled={busy}
          >
            {busy ? t("trips:export.downloading") : t("trips:export.download")}
          </button>
        </>
      }
    >
      <p className="text-sm text-(--text-muted)">{t("trips:export.intro")}</p>
      <p className="mt-3 text-sm font-medium" data-testid="trip-export-warning">
        {t("trips:export.leavesServer")}
      </p>
      <div className="mt-4 flex flex-col gap-3">
        {OPTIONS.map((key) => (
          <label key={key} className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={options[key]}
              onChange={(e) => setOptions((current) => ({ ...current, [key]: e.target.checked }))}
            />
            <span>
              <span className="font-medium">{t(`trips:export.options.${key}`)}</span>
              <span className="block text-(--text-muted)">
                {t(`trips:export.options.${key}Hint`)}
              </span>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 font-medium text-(--danger)">
          {error}
        </p>
      )}
      {done && !error && <p className="mt-3 text-sm">{t("trips:export.done")}</p>}
    </Modal>
  );
}
