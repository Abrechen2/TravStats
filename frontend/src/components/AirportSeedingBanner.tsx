import { useEffect, useState } from "react";
import { setupApi } from "../lib/api";
import { useTranslation } from "../hooks/useTranslation";
import { logger } from "../lib/logger";

interface SeedingStatus {
  status: "pending" | "running" | "completed" | "failed";
  progress?: number;
  estimatedSecondsRemaining?: number;
  totalAirports?: number;
  processedAirports?: number;
  error?: string;
}

interface AirportSeedingBannerProps {
  onStatusChange?: (status: SeedingStatus | null) => void;
}

export default function AirportSeedingBanner({
  onStatusChange,
}: AirportSeedingBannerProps): JSX.Element | null {
  const { t } = useTranslation(["common", "setup"]);
  const [status, setStatus] = useState<SeedingStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const fetchStatus = async () => {
    try {
      const data = await setupApi.getAirportSeedingStatus();
      setStatus(data);
      onStatusChange?.(data);

      // Stop polling if completed or failed
      if (data.status === "completed" || data.status === "failed") {
        setIsPolling(false);
      } else if (data.status === "running" || data.status === "pending") {
        setIsPolling(true);
      }
    } catch (error) {
      logger.error("Failed to fetch seeding status:", error);
      setIsPolling(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchStatus();
  }, []);

  useEffect(() => {
    // Poll every 2-3 seconds if seeding is in progress
    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (isPolling) {
      intervalId = setInterval(fetchStatus, 2500);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isPolling]);

  // Don't show banner if not seeding or already completed
  if (!status || status.status === "completed") {
    return null;
  }

  // Format estimated time
  const formatEstimatedTime = (seconds?: number): string => {
    if (!seconds || seconds < 10) {
      return t("setup:airportSeeding.calculating");
    }

    if (seconds < 60) {
      return t("setup:airportSeeding.estimatedSeconds", { seconds });
    }

    const minutes = Math.ceil(seconds / 60);
    if (minutes === 1) {
      return t("setup:airportSeeding.estimatedMinute");
    }
    return t("setup:airportSeeding.estimatedMinutes", { minutes });
  };

  const progress = status.progress ?? 0;
  const progressPercent = Math.round(progress * 100);

  return (
    <div
      className="w-full shadow-xs"
      style={{
        background: "var(--accent-soft)",
        borderBottom: "1px solid rgba(240,169,71,0.35)",
      }}
    >
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="shrink-0 mt-0.5">
            {status.status === "running" ? (
              <div className="animate-spin text-(--accent)">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
            ) : status.status === "failed" ? (
              <svg
                className="w-5 h-5 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            ) : (
              <svg
                className="w-5 h-5 text-(--accent)"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-4 mb-2">
              <div>
                <h3 className="text-sm font-semibold text-(--text-primary)">
                  {status.status === "running"
                    ? t("setup:airportSeeding.banner.loading")
                    : status.status === "failed"
                      ? t("setup:airportSeeding.banner.failed")
                      : t("setup:airportSeeding.banner.preparing")}
                </h3>
                <p className="text-xs text-(--text-muted) mt-0.5">
                  {status.status === "running"
                    ? t("setup:airportSeeding.banner.limitedFeatures")
                    : status.status === "failed"
                      ? status.error || t("setup:airportSeeding.banner.errorOccurred")
                      : t("setup:airportSeeding.banner.pleaseWait")}
                </p>
              </div>

              {/* Status info */}
              {status.status === "running" && (
                <div className="shrink-0 text-right">
                  {status.processedAirports !== undefined && status.totalAirports !== undefined && (
                    <p className="text-xs text-(--accent) font-medium">
                      {status.processedAirports} / {status.totalAirports}
                    </p>
                  )}
                  {status.estimatedSecondsRemaining !== undefined && (
                    <p className="text-xs text-(--text-muted) mt-0.5">
                      {formatEstimatedTime(status.estimatedSecondsRemaining)}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Progress bar */}
            {status.status === "running" && (
              <div className="space-y-1">
                <div
                  className="w-full rounded-full h-2"
                  style={{ background: "var(--bg-elevated)" }}
                >
                  <div
                    className="h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progressPercent}%`, background: "var(--accent)" }}
                  ></div>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-(--accent)">
                    {t("setup:airportSeeding.banner.progress", { percent: progressPercent })}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
