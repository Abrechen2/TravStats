import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { authApi } from "../lib/api";
import { useTranslation } from "../hooks/useTranslation";
import { LogoLockup } from "../components/Brand/Logo";

export default function ResetPasswordPage(): JSX.Element {
  const { t } = useTranslation(["auth"]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError(t("auth:resetPassword.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("auth:resetPassword.passwordsNotMatch"));
      return;
    }
    if (!token) {
      setError(t("auth:resetPassword.invalidToken"));
      return;
    }

    setLoading(true);
    try {
      await authApi.resetPassword(token, newPassword);
      setSuccess(true);
      setTimeout(() => {
        navigate("/login", { state: { message: t("auth:resetPassword.success") } });
      }, 2000);
    } catch {
      setError(t("auth:resetPassword.invalidToken"));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center relative">
        <div className="auth-bg" />
        <div className="relative z-10 w-full max-w-sm px-4 text-center">
          <p style={{ color: "var(--text-muted)" }}>{t("auth:resetPassword.invalidToken")}</p>
          <Link
            to="/login"
            className="hover:underline mt-4 inline-block"
            style={{ color: "var(--accent)" }}
          >
            {t("auth:resetPassword.backToLogin")}
          </Link>
        </div>
      </div>
    );
  }

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
        className="relative z-10 w-full max-w-sm px-4"
      >
        <div className="flex flex-col items-center text-center mb-8 gap-3">
          <LogoLockup size={26} markSize={72} layout="stacked" />
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("auth:resetPassword.title")}
          </p>
        </div>

        <div
          className="rounded-2xl p-8"
          style={{
            background: "rgba(28, 33, 40, 0.85)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--color-border)",
            borderTop: "2px solid var(--accent)",
          }}
        >
          {success ? (
            <div className="text-center">
              <p className="text-green-400 mb-4">{t("auth:resetPassword.success")}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="newPassword"
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t("auth:resetPassword.newPassword")}
                </label>
                <input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input w-full"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t("auth:resetPassword.confirmPassword")}
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input w-full"
                  required
                />
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
                {loading ? t("auth:resetPassword.submitting") : t("auth:resetPassword.submit")}
              </button>
            </form>
          )}

          <div className="mt-6 text-center text-sm">
            <Link to="/login" className="hover:underline" style={{ color: "var(--accent)" }}>
              {t("auth:resetPassword.backToLogin")}
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
