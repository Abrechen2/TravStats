import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi, settingsApi, setupApi, versionApi } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useTranslation } from "../hooks/useTranslation";
import DomainPickerStep from "../components/Setup/DomainPickerStep";
import UsageStatsConsentCard from "../components/UsageStatsConsentCard";
import type { DomainKey } from "../shared/domains";
import { logger } from "../lib/logger";

/** The shared demo account's fixed, published credentials (`seedDemoAccount.ts`). */
const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = "demo123";

export default function SetupPage(): JSX.Element {
  const navigate = useNavigate();
  const { t } = useTranslation(["setup", "common"]);
  const { setAuth } = useAuthStore();
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    confirmPassword: "",
  });
  const [selectedDomains, setSelectedDomains] = useState<DomainKey[]>(["flight"]);
  const [usageStatsConsent, setUsageStatsConsent] = useState<"granted" | "denied" | undefined>(
    undefined
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Whether the shared demo account can be offered before any admin exists
  // (owner, 2026-09-27: "Demo soll auch ohne Admin gehen" / "vor setup muss
  // es eine Demo Option geben"). Fetched the same way LoginPage learns
  // `publicDemoLogin` — fail closed, so a broken request just hides the
  // section instead of drawing a button that cannot work.
  const [demoAccountAvailable, setDemoAccountAvailable] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState("");

  useEffect(() => {
    setupApi
      .getStatus()
      .then((status) => setDemoAccountAvailable(status.demoAccountAvailable === true))
      .catch(() => setDemoAccountAvailable(false));
  }, []);

  const handleDemoLogin = async (): Promise<void> => {
    setDemoError("");
    setDemoLoading(true);
    try {
      // The SAME login call the ordinary sign-in page uses — no second
      // credential path for the demo button to drift from.
      const result = await authApi.login(DEMO_USERNAME, DEMO_PASSWORD);
      if ("user" in result) {
        setAuth(result.user);
        navigate("/");
      } else {
        // The shared demo account is not expected to carry 2FA or a forced
        // password change. If it ever does, this button cannot resolve that
        // on its own — say so rather than doing nothing.
        setDemoError(t("setup:demo.error"));
      }
    } catch (err) {
      logger.debug("demo login from setup failed", err);
      setDemoError(t("setup:demo.error"));
    } finally {
      setDemoLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!formData.username || !formData.password) {
      setError(t("setup:validation.usernamePasswordRequired"));
      return;
    }

    if (formData.password.length < 8) {
      setError(t("setup:validation.passwordTooShort"));
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError(t("setup:validation.passwordsDoNotMatch"));
      return;
    }

    setLoading(true);

    try {
      const frontendUrl =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : undefined;
      const response = await setupApi.initialize({
        username: formData.username,
        password: formData.password,
        frontendUrl,
        enabledDomains: selectedDomains,
        usageStatsConsent,
      });

      // Stamp BEFORE setAuth: setAuth flips isAuthenticated, which fires the
      // useWhatsNew effect. If the stamp has not landed by then, the hook reads a
      // pre-stamp snapshot and greets a brand-new install about a version it never
      // ran. The JWT cookie is already set by initialize(), so this call is
      // authenticated. Non-fatal: worst case is one stale modal.
      try {
        const { version } = await versionApi.get();
        await settingsApi.update({ whatsNewSeenVersion: version });
      } catch (error) {
        logger.debug("failed to stamp whatsNewSeenVersion during setup", error);
      }

      setAuth(response.user);

      setSuccess(true);
      setLoading(false);

      setTimeout(() => {
        navigate("/");
      }, 2000);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { error?: string } } };
      setError(apiError.response?.data?.error || t("setup:errors.failed"));
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="max-w-md w-full">
        <div className="bg-(--bg-elevated) rounded-lg shadow-xl p-8">
          <div className="text-center mb-8">
            <div className="text-5xl mb-4">✈️</div>
            <h1 className="t-screen-title mb-2">
              {t("setup:title", { appName: t("common:app.name") })}
            </h1>
            <p className="text-(--text-muted)">{t("setup:subtitle")}</p>
          </div>

          <p className="text-sm text-center text-(--text-muted) mb-6">
            🔒 {t("setup:privacy.items.dataStays")}
          </p>

          {!success && demoAccountAvailable && (
            <div
              className="rounded-lg p-4 mb-6"
              style={{ background: "var(--bg-muted)", border: "1px dashed var(--color-border)" }}
            >
              <h2 className="text-sm font-semibold mb-1 text-(--text-primary)">
                {t("setup:demo.title")}
              </h2>
              <p className="text-xs text-(--text-muted) mb-3">{t("setup:demo.description")}</p>
              {demoError && (
                <p className="text-xs mb-2" style={{ color: "var(--danger)" }} role="alert">
                  {demoError}
                </p>
              )}
              <button
                type="button"
                onClick={() => void handleDemoLogin()}
                disabled={demoLoading}
                className="btn-secondary w-full py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {demoLoading ? t("setup:demo.loading") : t("setup:demo.cta")}
              </button>
            </div>
          )}

          {!success && demoAccountAvailable && (
            <p className="text-xs text-center text-(--text-muted) mb-4">
              {t("setup:sections.admin")}
            </p>
          )}

          {success ? (
            <div className="space-y-4">
              <div
                className="rounded-lg p-6 text-center"
                style={{
                  background: "rgba(63,185,80,0.10)",
                  border: "1px solid rgba(63,185,80,0.35)",
                }}
              >
                <div className="text-5xl mb-4">✅</div>
                <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--success)" }}>
                  {t("setup:success.title")}
                </h2>
                <p className="mb-4" style={{ color: "var(--text-primary)" }}>
                  {t("setup:success.adminCreated", { username: formData.username })}
                </p>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {t("setup:success.redirecting")}
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div
                  className="rounded-lg p-3 text-sm"
                  style={{
                    background: "rgba(248,81,73,0.10)",
                    border: "1px solid rgba(248,81,73,0.35)",
                    color: "var(--danger)",
                  }}
                >
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-(--text-secondary) mb-1">
                  {t("setup:form.adminUsername.label")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--accent) bg-(--bg-muted) text-(--text-primary)"
                  placeholder={t("setup:form.adminUsername.placeholder")}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-(--text-secondary) mb-1">
                  {t("setup:form.password.label")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--accent) bg-(--bg-muted) text-(--text-primary)"
                  placeholder={t("setup:form.password.placeholder")}
                  required
                  minLength={8}
                />
                <p className="text-xs text-(--text-muted) mt-1">{t("setup:form.password.help")}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-(--text-secondary) mb-1">
                  {t("setup:form.confirmPassword.label")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  className="w-full px-4 py-2 border border-(--color-border) rounded-lg focus:ring-2 focus:ring-(--accent) bg-(--bg-muted) text-(--text-primary)"
                  placeholder={t("setup:form.confirmPassword.placeholder")}
                  required
                  minLength={8}
                />
              </div>

              <div className="pt-2">
                <DomainPickerStep value={selectedDomains} onChange={setSelectedDomains} />
              </div>

              <div className="pt-2">
                <UsageStatsConsentCard variant="setup" onDecided={setUsageStatsConsent} />
              </div>

              <p className="text-xs text-center text-(--text-muted) pt-2">
                {t("setup:instanceSettingsLater")}
              </p>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full font-semibold py-3 px-4 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? t("setup:form.submit.creating") : t("setup:form.submit.create")}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
