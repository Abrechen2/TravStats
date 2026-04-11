import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { authApi } from "../lib/api";
import { useTranslation } from "../hooks/useTranslation";

interface LocationState {
  changeToken?: string;
}

export default function ForceChangePasswordPage(): JSX.Element {
  const { t } = useTranslation(["auth"]);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const changeToken = state?.changeToken;

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!changeToken) {
      navigate("/login");
    }
  }, [changeToken, navigate]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError(t("auth:forceChangePassword.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("auth:forceChangePassword.passwordsNotMatch"));
      return;
    }
    if (!changeToken) {
      setError(t("auth:forceChangePassword.invalidToken"));
      return;
    }

    setLoading(true);
    try {
      await authApi.forceChangePassword(changeToken, newPassword);
      navigate("/login", { state: { message: t("auth:forceChangePassword.success") } });
    } catch {
      setError(t("auth:forceChangePassword.invalidToken"));
    } finally {
      setLoading(false);
    }
  };

  if (!changeToken) {
    return <div />;
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
        <div className="text-center mb-8">
          <h1
            className="text-4xl font-display font-bold tracking-widest uppercase"
            style={{ color: "var(--text-primary)" }}
          >
            TRAV<span style={{ color: "var(--accent)" }}>.</span>STATS
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("auth:forceChangePassword.title")}
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
          <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
            {t("auth:forceChangePassword.description")}
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="newPassword"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("auth:forceChangePassword.newPassword")}
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
                {t("auth:forceChangePassword.confirmPassword")}
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
              {loading
                ? t("auth:forceChangePassword.submitting")
                : t("auth:forceChangePassword.submit")}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
