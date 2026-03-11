import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { authApi } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useTranslation } from "../hooks/useTranslation";

export default function RegisterPage(): JSX.Element {
  const { t } = useTranslation(["auth", "common"]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError(t("register.passwordsNotMatch"));
      return;
    }
    if (password.length < 6) {
      setError(t("register.passwordTooShort"));
      return;
    }
    setLoading(true);
    try {
      const { user } = await authApi.register(username, password);
      setAuth(user);
      navigate("/");
    } catch (err: unknown) {
      const errorObj = err as { response?: { data?: { error?: string } } };
      setError(errorObj.response?.data?.error || t("register.failed"));
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
            {t("register.title")}
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
          {error && (
            <div
              className="px-4 py-3 rounded-lg mb-4 text-sm"
              style={{
                background: "rgba(248,81,73,0.12)",
                border: "1px solid var(--danger)",
                color: "var(--danger)",
              }}
            >
              {error}
            </div>
          )}
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
              />
            </div>
            <div>
              <label htmlFor="reg-password" className="label">
                {t("register.password")}
              </label>
              <input
                id="reg-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                autoComplete="new-password"
                required
              />
            </div>
            <div>
              <label htmlFor="reg-confirm" className="label">
                {t("register.confirmPassword")}
              </label>
              <input
                id="reg-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input"
                autoComplete="new-password"
                required
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
              {loading ? t("register.submitting") : t("register.submit")}
            </button>
          </form>
          <p className="mt-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {t("register.hasAccount")}{" "}
            <Link
              to="/login"
              className="font-medium transition-colors"
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
