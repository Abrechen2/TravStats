import { Icon } from "./ui/Icon";
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial fetch on mount; fetchStatus only calls stable state setters
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the poll follows isPolling; fetchStatus only calls stable state setters
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
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="shrink-0 mt-0.5">
            {status.status === "running" ? (
              <div className="animate-spin text-(--accent)">
                <Icon name="refresh-cw" size={20} />
              </div>
            ) : status.status === "failed" ? (
              <Icon name="circle-alert" size={20} style={{ color: "var(--ts-bad)" }} />
            ) : (
              <Icon name="info" size={20} style={{ color: "var(--ts-accent)" }} />
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
