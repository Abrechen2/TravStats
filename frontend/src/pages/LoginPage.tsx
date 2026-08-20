import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { startAuthentication } from "@simplewebauthn/browser";
import { authApi, passkeyApi } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useTranslation } from "../hooks/useTranslation";
import { LogoLockup } from "../components/Brand/Logo";
import { PasswordInput } from "../components/Auth/PasswordInput";

export default function LoginPage(): JSX.Element {
  const { t } = useTranslation(["auth", "common"]);
  const location = useLocation();
  const state = location.state as { message?: string; username?: string } | null;

  const [username, setUsername] = useState(state?.username || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMessage] = useState(state?.message || "");
  const [passkeysAvailable, setPasskeysAvailable] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  // Forgot password modal state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [smtpEnabled, setSmtpEnabled] = useState<boolean | null>(null);
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);
  const [adminContactEmail, setAdminContactEmail] = useState<string | null>(null);
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);
  const [forgotError, setForgotError] = useState("");

  useEffect(() => {
    authApi
      .getSmtpStatus()
      .then((r) => {
        setSmtpEnabled(r.smtpEnabled);
        setAdminContactEmail(r.adminContactEmail);
      })
      .catch(() => setSmtpEnabled(false));
  }, []);

  // #258: don't advertise a locked door. When registration is disabled the
  // "Registrieren" link is hidden — invited users never come through it (an
  // invitation lands directly on /register?token=…). Fail-open on error,
  // matching RegisterPage's convention: worst case is the old behaviour.
  useEffect(() => {
    authApi
      .getRegistrationStatus()
      .then((r) => setRegistrationEnabled(r.registrationEnabled))
      .catch(() => setRegistrationEnabled(true));
  }, []);

  // Ask before drawing the button: on an insecure origin WebAuthn is impossible
  // and a button that always throws is worse than no button.
  //
  // BOTH conditions matter. The server only knows its CONFIGURED origins; this
  // instance may also be reachable under a plain-http LAN address, where the
  // config says "available" but THIS page cannot run WebAuthn. UAT on the beta
  // box found exactly that: tunnel https configured, browsed via LAN http, and
  // the button appeared without being able to work. isSecureContext is the
  // browser's own verdict about the page we are actually on.
  useEffect(() => {
    passkeyApi
      .availability()
      .then((r) => setPasskeysAvailable(r.available && window.isSecureContext !== false))
      .catch(() => setPasskeysAvailable(false));
  }, []);

  const handlePasskeyLogin = async (): Promise<void> => {
    setError("");
    setPasskeyLoading(true);
    try {
      const options = await passkeyApi.loginOptions();
      const response = await startAuthentication({ optionsJSON: options });
      const result = await passkeyApi.loginVerify(response);
      setAuth(result.user);
      navigate("/");
    } catch (err) {
      // Cancelling the OS or password-manager dialog is a normal user action.
      if (err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError")) {
        return;
      }
      setError(t("login.passkeyFailed"));
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await authApi.login(username, password);
      if ("requiresTwoFactor" in result && result.requiresTwoFactor) {
        // The challenge rides in an HttpOnly cookie — nothing to hand over here.
        navigate("/2fa");
      } else if ("requiresPasswordChange" in result && result.requiresPasswordChange) {
        // changeToken is now delivered via HttpOnly cookie, not response body
        navigate("/change-password", { state: { requiresChange: true } });
      } else if ("user" in result) {
        setAuth(result.user);
        navigate("/");
      }
    } catch (err: unknown) {
      const errorObj = err as {
        response?: { status?: number; data?: { error?: string; code?: string } };
        message?: string;
      };
      const serverError = errorObj.response?.data?.error;
      const status = errorObj.response?.status;
      if (!errorObj.response) {
        setError(t("login.serverUnreachable"));
      } else if (status === 503 || errorObj.response?.data?.code === "DB_UNAVAILABLE") {
        setError(t("login.dbUnavailable"));
      } else {
        setError(serverError || t("login.failed"));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setForgotError("");
    setForgotLoading(true);
    try {
      await authApi.forgotPassword(forgotUsername);
      setForgotSuccess(true);
    } catch {
      setForgotError(t("login.failed"));
    } finally {
      setForgotLoading(false);
    }
  };

  const handleCloseForgotModal = (): void => {
    setShowForgotModal(false);
    setForgotUsername("");
    setForgotSuccess(false);
    setForgotError("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative">
      <div className="auth-bg" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.35,
          ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
        }}
        className="relative z-10 w-full max-w-sm px-4 sm:px-4"
      >
        {/* Brand lockup */}
        <div className="flex flex-col items-center text-center mb-8 gap-3">
          <LogoLockup size={26} markSize={72} layout="stacked" />
          <h1
            className="mt-2 text-2xl font-display font-semibold tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            {t("login.heading")}
          </h1>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl px-6 py-8 sm:px-8"
          style={{
            background: "rgba(28, 33, 40, 0.85)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--color-border)",
            borderTop: "2px solid var(--accent)",
          }}
        >
          {successMessage && (
            <div className="mb-4 p-3 rounded-lg bg-green-900/20 border border-green-500/30">
              <p className="text-sm text-green-400 text-center">{successMessage}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("login.username")}
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input w-full"
                autoComplete="username"
                autoFocus
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("login.password")}
              </label>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 text-center" role="alert">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
              {loading ? t("login.submitting") : t("login.submit")}
            </button>
          </form>

          {passkeysAvailable && (
            <div className="mt-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="h-px flex-1" style={{ background: "var(--color-border)" }} />
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("login.or")}
                </span>
                <span className="h-px flex-1" style={{ background: "var(--color-border)" }} />
              </div>
              <button
                type="button"
                disabled={passkeyLoading}
                onClick={() => void handlePasskeyLogin()}
                className="btn-secondary w-full py-2.5"
              >
                {passkeyLoading ? t("login.passkeySubmitting") : t("login.passkeySubmit")}
              </button>
            </div>
          )}

          <div className="mt-5 flex flex-col items-center gap-2 text-sm">
            {registrationEnabled !== false && (
              <span style={{ color: "var(--text-muted)" }}>
                {t("login.noAccount")}{" "}
                <Link
                  to="/register"
                  className="font-medium hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  {t("login.register")}
                </Link>
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowForgotModal(true)}
              className="font-medium hover:underline"
              style={{ color: "var(--accent)" }}
            >
              {t("login.forgotPassword")}
            </button>
          </div>
        </div>
      </motion.div>

      {/* Forgot Password Modal */}
      <AnimatePresence>
        {showForgotModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.7)" }}
            onClick={handleCloseForgotModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="forgot-modal-title"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl p-6"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              <h2
                id="forgot-modal-title"
                className="text-lg font-semibold mb-4"
                style={{ color: "var(--text-primary)" }}
              >
                {t("login.forgotPasswordModal.title")}
              </h2>

              {smtpEnabled === false ? (
                <div className="text-sm space-y-2 mb-4" style={{ color: "var(--text-muted)" }}>
                  <p>{t("login.forgotPasswordModal.noSmtp")}</p>
                  {adminContactEmail && (
                    <p>
                      {t("login.forgotPasswordModal.noSmtpContact")}{" "}
                      <a
                        href={`mailto:${adminContactEmail}`}
                        className="font-medium hover:underline"
                        style={{ color: "var(--accent)" }}
                      >
                        {adminContactEmail}
                      </a>
                    </p>
                  )}
                </div>
              ) : forgotSuccess ? (
                <p className="text-sm text-green-400 mb-4">
                  {t("login.forgotPasswordModal.success")}
                </p>
              ) : (
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  <div>
                    <label
                      htmlFor="forgotUsername"
                      className="block text-sm font-medium mb-1.5"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {t("login.forgotPasswordModal.usernameLabel")}
                    </label>
                    <input
                      id="forgotUsername"
                      type="text"
                      value={forgotUsername}
                      onChange={(e) => setForgotUsername(e.target.value)}
                      className="input w-full"
                      placeholder={t("login.forgotPasswordModal.usernamePlaceholder")}
                      required
                      autoFocus
                    />
                  </div>
                  {forgotError && <p className="text-sm text-red-400">{forgotError}</p>}
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="btn-primary w-full py-2"
                  >
                    {forgotLoading
                      ? t("login.forgotPasswordModal.submitting")
                      : t("login.forgotPasswordModal.submit")}
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={handleCloseForgotModal}
                className="btn-secondary w-full mt-4 py-2 text-sm"
              >
                {t("login.forgotPasswordModal.close")}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
