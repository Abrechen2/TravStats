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
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div
          className="fixed inset-0 transition-opacity bg-[var(--bg-base)]0 bg-opacity-75"
          onClick={onClose}
        ></div>

        {/* Modal */}
        <div className="inline-block align-bottom bg-(--bg-surface) rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div className="bg-(--bg-surface) px-4 pt-5 pb-4 sm:p-6">
            <div className="sm:flex sm:items-start">
              <div className="mx-auto shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 sm:mx-0 sm:h-10 sm:w-10">
                <svg className="h-6 w-6 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
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
              </div>
              <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                <h3 className="text-lg leading-6 font-medium text-(--text-primary)">
                  {t("setup:airportSeeding.modal.title")}
                </h3>
                <div className="mt-2">
                  <p className="text-sm text-(--text-muted)">
                    {t("setup:airportSeeding.modal.description")}
                  </p>

                  {status.status === "running" && (
                    <div className="mt-4 space-y-2">
                      <div className="w-full bg-(--bg-muted) rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${progressPercent}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-xs text-(--text-muted)">
                        <span>
                          {t("setup:airportSeeding.modal.progress", { percent: progressPercent })}
                        </span>
                        {status.processedAirports !== undefined &&
                          status.totalAirports !== undefined && (
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
            </div>
          </div>
          <div className="bg-(--bg-base) px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              onClick={onClose}
              className="btn-primary w-full justify-center sm:ml-3 sm:w-auto"
            >
              {t("setup:airportSeeding.modal.understood")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
