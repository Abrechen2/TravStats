import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
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

  const handleSubmit = async (e: React.FormEvent) => {
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
      <div className="card w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <img
            src="/logo-with-text.png"
            alt={t("common:app.logoAlt")}
            className="h-24 w-auto mb-4"
          />
          <h1 className="text-3xl font-bold text-center">{t("common:app.name")}</h1>
        </div>
        <h2 className="text-xl text-gray-600 dark:text-gray-300 text-center mb-8">
          {t("login.title")}
        </h2>

        {state?.message && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
            {state.message}
          </div>
        )}

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
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

          <button
            type="submit"
            disabled={loading}
            className={`btn-primary w-full ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {loading ? t("login.submitting") : t("login.submit")}
          </button>
        </form>

        <p className="mt-6 text-center text-gray-600 dark:text-gray-400">
          {t("login.noAccount")}{" "}
          <Link to="/register" className="text-blue-600 dark:text-blue-400 hover:underline">
            {t("login.register")}
          </Link>
        </p>
      </div>
    </div>
  );
}
