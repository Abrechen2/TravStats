import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setupApi } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useTranslation } from "../hooks/useTranslation";

export default function SetupPage(): JSX.Element {
  const navigate = useNavigate();
  const { t } = useTranslation(["setup", "common"]);
  const { setAuth } = useAuthStore();
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    instanceName: "TravStats",
    frontendUrl: "",
    maxUsers: 10,
    allowRegistration: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Pre-fill frontendUrl with the current origin — a fresh install is almost
  // always reached through the URL the operator will actually share.
  useEffect(() => {
    if (!formData.frontendUrl && typeof window !== "undefined" && window.location?.origin) {
      setFormData((prev) => ({ ...prev, frontendUrl: window.location.origin }));
    }
  }, [formData.frontendUrl]);

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
      const response = await setupApi.initialize({
        username: formData.username,
        password: formData.password,
        instanceName: formData.instanceName || undefined,
        frontendUrl: formData.frontendUrl || undefined,
        maxUsers: formData.maxUsers,
        allowRegistration: formData.allowRegistration,
      });

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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="text-5xl mb-4">✈️</div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              {t("setup:title", { appName: t("common:app.name") })}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">{t("setup:subtitle")}</p>
          </div>

          {/* Privacy hint */}
          <p className="text-sm text-center text-gray-500 dark:text-gray-400 mb-6">
            🔒 {t("setup:privacy.items.dataStays")}
          </p>

          {success ? (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6 text-center">
                <div className="text-5xl mb-4">✅</div>
                <h2 className="text-2xl font-bold text-green-900 dark:text-green-100 mb-2">
                  {t("setup:success.title")}
                </h2>
                <p className="text-green-800 dark:text-green-200 mb-4">
                  {t("setup:success.adminCreated", { username: formData.username })}
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  {t("setup:success.redirecting")}
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-800 dark:text-red-200 text-sm">
                  {error}
                </div>
              )}

              {/* Admin account */}
              <div className="pt-2">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">
                  {t("setup:sections.admin")}
                </h2>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("setup:form.adminUsername.label")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder={t("setup:form.adminUsername.placeholder")}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("setup:form.password.label")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder={t("setup:form.password.placeholder")}
                  required
                  minLength={8}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("setup:form.password.help")}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("setup:form.confirmPassword.label")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder={t("setup:form.confirmPassword.placeholder")}
                  required
                  minLength={8}
                />
              </div>

              {/* Instance section */}
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">
                  {t("setup:sections.instance")}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  {t("setup:sections.instanceHint")}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("setup:form.instanceName.label")}
                </label>
                <input
                  type="text"
                  value={formData.instanceName}
                  onChange={(e) => setFormData({ ...formData, instanceName: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="TravStats"
                  maxLength={100}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("setup:form.frontendUrl.label")}
                </label>
                <input
                  type="url"
                  value={formData.frontendUrl}
                  onChange={(e) => setFormData({ ...formData, frontendUrl: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="https://travstats.example.com"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("setup:form.frontendUrl.help")}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("setup:form.maxUsers.label")}
                </label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={formData.maxUsers}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      maxUsers: Math.max(1, Math.min(1000, Number(e.target.value) || 10)),
                    })
                  }
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("setup:form.maxUsers.help")}
                </p>
              </div>

              <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={formData.allowRegistration}
                  onChange={(e) =>
                    setFormData({ ...formData, allowRegistration: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-gray-300 dark:border-gray-600"
                />
                <span>
                  <span className="font-medium">{t("setup:form.allowRegistration.label")}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {t("setup:form.allowRegistration.help")}
                  </span>
                </span>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
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
