import Modal from "./Modal";
import { useEffect, useState } from "react";
import { setupApi } from "../lib/api";
import { useTranslation } from "../hooks/useTranslation";
import { logger } from "../lib/logger";

interface AirportSeedingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AirportSeedingModal({
  isOpen,
  onClose,
}: AirportSeedingModalProps): JSX.Element | null {
  const { t } = useTranslation(["common", "setup"]);
  const [status, setStatus] = useState<{
    status: "pending" | "running" | "completed" | "failed";
    progress?: number;
    estimatedSecondsRemaining?: number;
    totalAirports?: number;
    processedAirports?: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      // Poll status every 2 seconds
      const interval = setInterval(fetchStatus, 2000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const fetchStatus = async () => {
    try {
      const data = await setupApi.getAirportSeedingStatus();
      setStatus(data);
      // Auto-close if completed
      if (data.status === "completed") {
        setTimeout(onClose, 2000);
      }
    } catch (error) {
      logger.error("Failed to fetch seeding status:", error);
    }
  };

  if (!isOpen || !status || status.status === "completed") {
    return null;
  }

  const progress = status.progress ?? 0;
  const progressPercent = Math.round(progress * 100);

  return (
    <Modal
      open
      onClose={onClose}
      title={t("setup:airportSeeding.modal.title")}
      maxWidth={512}
      footer={
        <button type="button" onClick={onClose} className="btn-primary">
          {t("setup:airportSeeding.modal.understood")}
        </button>
      }
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--accent-soft)" }}
        >
          <svg
            className="h-6 w-6 animate-spin"
            style={{ color: "var(--accent)" }}
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-sm text-(--text-muted)">
            {t("setup:airportSeeding.modal.description")}
          </p>

          {status.status === "running" && (
            <div className="mt-4 space-y-2">
              <div className="h-2 w-full rounded-full bg-(--bg-muted)">
                <div
                  className="h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%`, background: "var(--accent)" }}
                ></div>
              </div>
              <div className="flex justify-between text-xs text-(--text-muted)">
                <span>
                  {t("setup:airportSeeding.modal.progress", { percent: progressPercent })}
                </span>
                {status.processedAirports !== undefined && status.totalAirports !== undefined && (
                  <span>
                    {t("setup:airportSeeding.modal.airportsCount", {
                      processed: status.processedAirports,
                      total: status.totalAirports,
                    })}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
