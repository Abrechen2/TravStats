import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { setupApi } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useTranslation } from "../hooks/useTranslation";
import DomainPickerStep from "../components/Setup/DomainPickerStep";
import type { DomainKey } from "../shared/domains";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

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
          <div className="text-center mb-8">
            <div className="text-5xl mb-4">✈️</div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              {t("setup:title", { appName: t("common:app.name") })}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">{t("setup:subtitle")}</p>
          </div>

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
                  autoFocus
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

              <div className="pt-2">
                <DomainPickerStep value={selectedDomains} onChange={setSelectedDomains} />
              </div>

              <p className="text-xs text-center text-gray-500 dark:text-gray-400 pt-2">
                {t("setup:instanceSettingsLater")}
              </p>

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
