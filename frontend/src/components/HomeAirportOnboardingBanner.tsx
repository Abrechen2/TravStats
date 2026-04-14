import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { settingsApi } from "../lib/api";
import { useTranslation } from "../hooks/useTranslation";
import { logger } from "../lib/logger";

/** LocalStorage key for "user dismissed the banner" — server knows nothing
 *  about this, and re-asking forever would be annoying. The banner also
 *  hides when the user has actually set a home airport. */
const DISMISSED_KEY = "travstats_home_airport_banner_dismissed";

export default function HomeAirportOnboardingBanner(): JSX.Element | null {
  const { t } = useTranslation(["common", "settings"]);
  const [loading, setLoading] = useState(true);
  const [hasHome, setHasHome] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    // No need to fetch — and pay rate-limit cost — when the banner has
    // already been dismissed for this session.
    if (dismissed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    settingsApi
      .getHomeAirports()
      .then((res) => {
        if (cancelled) return;
        const active = res.history.find((e) => e.toDate === null);
        setHasHome(Boolean(active));
      })
      .catch((err) => {
        logger.warn("HomeAirportBanner: failed to fetch history:", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dismissed]);

  if (loading || hasHome || dismissed) return null;

  const handleDismiss = (): void => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // ignore storage failure (private mode etc.)
    }
    setDismissed(true);
  };

  return (
    <div
      className="rounded-lg p-4 flex items-center gap-4"
      style={{
        background: "rgba(207,141,32,0.08)",
        border: "1px solid rgba(207,141,32,0.25)",
      }}
    >
      <div className="flex-1">
        <p className="font-semibold" style={{ color: "var(--accent)" }}>
          {t("settings:homeAirport.bannerTitle")}
        </p>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("settings:homeAirport.bannerDescription")}
        </p>
      </div>
      <Link to="/settings" className="btn-primary whitespace-nowrap">
        {t("settings:homeAirport.setNow")}
      </Link>
      <button type="button" className="btn-secondary whitespace-nowrap" onClick={handleDismiss}>
        {t("common:buttons.later")}
      </button>
    </div>
  );
}
