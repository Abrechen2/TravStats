import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { api } from "../../lib/api/client";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";

const POLL_INTERVAL_MS = 2000;

interface LogoRefreshStatus {
  running: boolean;
  checked: number | null;
  refreshed: number | null;
}

function isLogoRefreshStatus(value: unknown): value is LogoRefreshStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    "running" in value &&
    typeof (value as { running: unknown }).running === "boolean"
  );
}

type RefreshState = "idle" | "running" | "done" | "error";

/**
 * Triggers the on-demand airline-logo refresh (Task 6's
 * POST /admin/airline-logos/refresh + GET .../refresh-status) and polls for
 * the result. Self-contained: owns its own request + poll state so it can be
 * dropped into any admin card without threading state through a parent.
 */
export default function AirlineLogoRefreshButton(): JSX.Element {
  const { t } = useTranslation("admin");
  const [state, setState] = useState<RefreshState>("idle");
  const [checked, setChecked] = useState(0);
  const [refreshed, setRefreshed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const poll = useCallback(async () => {
    try {
      const response = await api.get("/admin/airline-logos/refresh-status");
      const data: unknown = response.data;
      if (!mountedRef.current) return;

      if (!isLogoRefreshStatus(data)) {
        logger.error("Unexpected airline logo refresh-status shape:", data);
        setState("error");
        return;
      }

      if (data.running) {
        timerRef.current = setTimeout(() => {
          void poll();
        }, POLL_INTERVAL_MS);
        return;
      }

      setChecked(data.checked ?? 0);
      setRefreshed(data.refreshed ?? 0);
      setState("done");
    } catch (error) {
      logger.error("Failed to poll airline logo refresh status:", error);
      if (mountedRef.current) setState("error");
    }
  }, []);

  const handleClick = useCallback(async () => {
    setState("running");
    try {
      await api.post("/admin/airline-logos/refresh");
    } catch (error) {
      // A 409 means a refresh is already running elsewhere — that's not a
      // failure, just start polling the one in flight.
      const alreadyRunning = axios.isAxiosError(error) && error.response?.status === 409;
      if (!alreadyRunning) {
        logger.error("Failed to trigger airline logo refresh:", error);
        if (mountedRef.current) setState("error");
        return;
      }
    }
    void poll();
  }, [poll]);

  return (
    <div className="mt-4">
      <button
        onClick={() => void handleClick()}
        disabled={state === "running"}
        className="btn-primary px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state === "running" ? t("airlineLogos.running") : t("airlineLogos.action")}
      </button>
      <p className="text-sm text-(--text-muted) mt-2">{t("airlineLogos.description")}</p>
      {state === "done" && (
        <p className="text-sm mt-1" style={{ color: "var(--success)" }}>
          {t("airlineLogos.result", { refreshed, checked })}
        </p>
      )}
      {state === "error" && (
        <p className="text-sm mt-1" style={{ color: "var(--danger)" }}>
          {t("airlineLogos.failed")}
        </p>
      )}
    </div>
  );
}
