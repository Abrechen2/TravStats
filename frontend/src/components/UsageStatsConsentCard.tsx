import { useState } from "react";
import { usageStatsApi } from "../lib/api";
import { logger } from "../lib/logger";
import { useTranslation } from "../hooks/useTranslation";

const DOCS_URL = "https://travstats.de/docs/usage-statistics";

interface UsageStatsConsentCardProps {
  onDecided?: (consent: "granted" | "denied") => void;
  /**
   * "modal": call the admin API directly (an admin session exists).
   * "setup": no session yet — the parent sends the choice with setupApi.initialize.
   */
  variant?: "modal" | "setup";
}

/**
 * Opt-in consent card. GDPR Art. 7: accept and decline must carry equal weight —
 * identical styling, neither pre-selected. Do not "improve" this by highlighting
 * the accept button.
 */
export default function UsageStatsConsentCard({
  onDecided,
  variant = "modal",
}: UsageStatsConsentCardProps): JSX.Element {
  const { t } = useTranslation(["usageStats"]);
  const [busy, setBusy] = useState(false);

  const buttonClass = "flex-1 px-4 py-2 rounded-md text-sm font-medium border";

  const decide = async (consent: "granted" | "denied"): Promise<void> => {
    setBusy(true);
    if (variant === "modal") {
      try {
        await usageStatsApi.setConsent(consent);
      } catch (error) {
        // The user's choice is recorded upward regardless: never trap someone
        // in a consent dialog because the network is down.
        logger.debug("usage-stats consent request failed", error);
      }
    }
    setBusy(false);
    onDecided?.(consent);
  };

  return (
    <section
      className="rounded-md p-4 flex flex-col gap-3"
      style={{ border: "1px solid var(--color-border)", background: "var(--bg-elevated)" }}
    >
      <h3 className="font-medium" style={{ color: "var(--text-primary)" }}>
        {t("usageStats:consent.title")}
      </h3>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {t("usageStats:consent.body")}
      </p>
      <a
        href={DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm underline w-fit"
        style={{ color: "var(--text-muted)" }}
      >
        {t("usageStats:consent.whatIsSent")}
      </a>

      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide("granted")}
          className={buttonClass}
          style={{ borderColor: "var(--color-border)", color: "var(--text-primary)" }}
        >
          {t("usageStats:consent.accept")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide("denied")}
          className={buttonClass}
          style={{ borderColor: "var(--color-border)", color: "var(--text-primary)" }}
        >
          {t("usageStats:consent.decline")}
        </button>
      </div>

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {t("usageStats:consent.revokeHint")}
      </p>
    </section>
  );
}
