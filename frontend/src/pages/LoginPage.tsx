import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { authApi } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useTranslation } from "../hooks/useTranslation";

export default function LoginPage(): JSX.Element {
  const { t } = useTranslation(["auth", "common"]);
  const location = useLocation();
  const state = location.state as { message?: string; username?: string } | null;

  const [username, setUsername] = useState(state?.username || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { user } = await authApi.login(username, password);
      setAuth(user);
      navigate("/");
    } catch (err: unknown) {
      const errorObj = err as { response?: { data?: { error?: string } } };
      setError(errorObj.response?.data?.error || t("login.failed"));
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
        {/* Wordmark */}
        <div className="text-center mb-8">
          <h1
            className="text-4xl font-display font-bold tracking-widest uppercase"
            style={{ color: "var(--text-primary)" }}
          >
            TRAV<span style={{ color: "var(--accent)" }}>.</span>STATS
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("login.title")}
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{
            background: "rgba(28, 33, 40, 0.85)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--color-border)",
            borderTop: "2px solid var(--accent)",
          }}
        >
          {state?.message && (
            <div
              className="px-4 py-3 rounded-lg mb-4 text-sm"
              style={{
                background: "rgba(63,185,80,0.12)",
                border: "1px solid var(--success)",
                color: "var(--success)",
              }}
            >
              {state.message}
            </div>
          )}

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
              <label htmlFor="login-username" className="label">
                {t("login.username")}
              </label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input"
                required
              />
            </div>
            <div>
              <label htmlFor="login-password" className="label">
                {t("login.password")}
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                required
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
              {loading ? t("login.submitting") : t("login.submit")}
            </button>
          </form>

          <p className="mt-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {t("login.noAccount")}{" "}
            <Link
              to="/register"
              className="font-medium transition-colors"
              style={{ color: "var(--accent)" }}
            >
              {t("login.register")}
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
