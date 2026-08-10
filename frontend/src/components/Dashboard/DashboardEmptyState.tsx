import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";

interface DashboardEmptyStateProps {
  /** Opens the same add-flight modal the toolbar "+" uses. */
  onAddFlight: () => void;
}

/**
 * Shown on a brand-new account (issue #237): straight after setup the dashboard
 * was an empty map, a legend of four things the user has none of, and a generic
 * "+" — 297 characters, none of which said what to do next. The people this app
 * is for usually arrive with years of history to IMPORT, which used to be three
 * clicks deep and never mentioned here.
 *
 * So import is the primary action. Adding one flight by hand and choosing which
 * domains to track are the two secondary paths. Deliberately minimal: three
 * routes out of the empty screen, not an onboarding wizard.
 */
export function DashboardEmptyState({ onAddFlight }: DashboardEmptyStateProps): JSX.Element {
  const { t } = useTranslation(["dashboard", "common"]);
  const navigate = useNavigate();

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center p-6"
      style={{ background: "color-mix(in srgb, var(--bg-base) 82%, transparent)" }}
    >
      <div
        className="w-full max-w-lg rounded-2xl p-8 text-center"
        style={{
          background: "rgba(28, 33, 40, 0.92)",
          border: "1px solid var(--color-border)",
          borderTop: "2px solid var(--accent)",
          backdropFilter: "blur(12px)",
        }}
      >
        <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          {t("dashboard:empty.title")}
        </h2>
        <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
          {t("dashboard:empty.subtitle")}
        </p>

        <div className="flex flex-col gap-3">
          {/* Primary: import. The single most valuable action for a new user
              with existing travel history. */}
          <button
            type="button"
            onClick={() => navigate("/settings?section=import")}
            className="cursor-pointer rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: "var(--accent)", color: "#0d1117", border: "none" }}
          >
            {t("dashboard:empty.import")}
          </button>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onAddFlight}
              className="flex-1 cursor-pointer rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                border: "1px solid var(--color-border)",
              }}
            >
              {t("dashboard:empty.addFlight")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/settings?section=modules")}
              className="flex-1 cursor-pointer rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                border: "1px solid var(--color-border)",
              }}
            >
              {t("dashboard:empty.chooseDomains")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
