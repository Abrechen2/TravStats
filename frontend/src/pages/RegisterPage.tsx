import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { authApi } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useTranslation } from "../hooks/useTranslation";
import { LogoLockup } from "../components/Brand/Logo";
import { PasswordInput } from "../components/Auth/PasswordInput";

export default function RegisterPage(): JSX.Element {
  const { t } = useTranslation(["auth", "common"]);
  const [searchParams] = useSearchParams();
  const invitationToken = searchParams.get("token") ?? undefined;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Registration availability — checked once on mount. While `null`, we
  // hide the form to avoid a flash of fillable fields that we'd then
  // disable on submit.
  const [registrationAllowed, setRegistrationAllowed] = useState<boolean | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  useEffect(() => {
    // Invitation tokens override the public registration toggle: the
    // backend always honors a valid token regardless of the global flag.
    if (invitationToken) {
      setRegistrationAllowed(true);
      return;
    }
    authApi
      .getRegistrationStatus()
      .then((r) => {
        setRegistrationAllowed(r.registrationEnabled);
        setLimitReached(r.limitReached);
      })
      .catch(() => {
        // Fail open — let the user try; the backend will reject if needed.
        setRegistrationAllowed(true);
      });
  }, [invitationToken]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError(t("register.passwordsNotMatch"));
      return;
    }
    if (password.length < 8) {
      setError(t("register.passwordTooShort"));
      return;
    }
    setLoading(true);
    try {
      const { user } = await authApi.register(username, password, invitationToken);
      setAuth(user);
      navigate("/");
    } catch (err: unknown) {
      const errorObj = err as {
        response?: {
          status?: number;
          data?: {
            error?: string;
            details?: Array<{ field?: string; message?: string }>;
          };
        };
      };
      // A 403 is "registration is disabled" — translate it instead of
      // rendering the backend's English prose (#258/#260). This is the
      // fail-open path: the status probe erred, the form rendered anyway,
      // and the submit is where the instance finally says no.
      if (errorObj.response?.status === 403) {
        setError(t("register.disabled"));
        return;
      }
      // Prefer the specific Zod validation message over the generic
      // "Validation error" envelope when the backend returns one.
      const detail = errorObj.response?.data?.details?.[0]?.message;
      const envelope = errorObj.response?.data?.error;
      setError(detail || envelope || t("register.failed"));
    } finally {
      setLoading(false);
    }
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
        <div className="flex flex-col items-center text-center mb-8 gap-3">
          <LogoLockup size={26} markSize={72} layout="stacked" />
          <h1 className="t-screen-title mt-2">{t("register.heading")}</h1>
        </div>
        <div
          className="rounded-2xl px-6 py-8 sm:px-8"
          style={{
            background: "rgba(28, 33, 40, 0.85)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--color-border)",
            borderTop: "2px solid var(--accent)",
          }}
        >
          {invitationToken && (
            <div
              className="px-4 py-3 rounded-lg mb-4 text-sm"
              style={{
                background: "rgba(34,197,94,0.12)",
                border: "1px solid rgba(34,197,94,0.5)",
                color: "#22c55e",
              }}
            >
              {t("register.invitationDetected")}
            </div>
          )}

          {error && (
            <div
              className="px-4 py-3 rounded-lg mb-4 text-sm text-center"
              style={{
                background: "rgba(248,81,73,0.12)",
                border: "1px solid var(--danger)",
                color: "var(--danger)",
              }}
              role="alert"
            >
              {error}
            </div>
          )}

          {registrationAllowed === false ? (
            <div
              className="px-4 py-3 rounded-lg mb-4 text-sm text-center"
              style={{
                background: "rgba(207,141,32,0.10)",
                border: "1px solid rgba(207,141,32,0.4)",
                color: "var(--text-secondary)",
              }}
            >
              {limitReached ? t("register.limitReached") : t("register.disabled")}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="reg-username" className="label">
                  {t("register.username")}
                </label>
                <input
                  id="reg-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input"
                  autoComplete="username"
                  required
                  disabled={registrationAllowed === null}
                />
              </div>
              <div>
                <label htmlFor="reg-password" className="label">
                  {t("register.password")}
                </label>
                <PasswordInput
                  id="reg-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  autoComplete="new-password"
                  required
                  disabled={registrationAllowed === null}
                />
              </div>
              <div>
                <label htmlFor="reg-confirm" className="label">
                  {t("register.confirmPassword")}
                </label>
                <PasswordInput
                  id="reg-confirm"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input"
                  autoComplete="new-password"
                  required
                  disabled={registrationAllowed === null}
                />
              </div>
              <button
                type="submit"
                disabled={loading || registrationAllowed === null}
                className="btn-primary w-full mt-2"
              >
                {loading ? t("register.submitting") : t("register.submit")}
              </button>
            </form>
          )}

          <p className="mt-4 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {t("register.hasAccount")}{" "}
            <Link
              to="/login"
              className="font-medium transition-colors hover:underline"
              style={{ color: "var(--accent)" }}
            >
              {t("register.signIn")}
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
