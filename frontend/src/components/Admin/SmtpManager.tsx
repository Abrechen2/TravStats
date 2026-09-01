import { useState, useEffect } from "react";
import HelpIcon from "../Help/HelpIcon";
import { useTranslation } from "../../hooks/useTranslation";
import { adminApi, type SmtpConfigInput } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import ConfirmModal from "../Training/ConfirmModal";

const DEFAULT_CONFIG: SmtpConfigInput = {
  host: "",
  port: 587,
  secure: false,
  username: "",
  password: "",
  fromEmail: "",
  fromName: "TravStats",
  enabled: false,
};

export default function SmtpManager(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const addToast = useToastStore((state) => state.addToast);

  const [config, setConfig] = useState<SmtpConfigInput>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  // Whether the SERVER holds a config (#255). The form is filled either way, so
  // only this decides whether there is anything to delete.
  const [configured, setConfigured] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const data = await adminApi.getSmtpConfig();
        if (data.configured) {
          setConfigured(true);
          setConfig({
            host: data.host ?? "",
            port: data.port ?? 587,
            secure: data.secure ?? false,
            username: data.username ?? "",
            password: "",
            fromEmail: data.fromEmail ?? "",
            fromName: data.fromName ?? "TravStats",
            enabled: data.enabled ?? false,
          });
        }
      } catch (err) {
        addToast(
          "error",
          err instanceof Error ? err.message : t("settings:notifications.loadError")
        );
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const handleChange = <K extends keyof SmtpConfigInput>(
    field: K,
    value: SmtpConfigInput[K]
  ): void => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    if (field === "password") {
      setPasswordChanged(true);
    }
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      await adminApi.saveSmtpConfig(config);
      setPasswordChanged(false);
      setConfigured(true);
      addToast("success", t("settings:notifications.saved"));
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save SMTP config");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      await adminApi.deleteSmtpConfig();
      setConfig(DEFAULT_CONFIG);
      setPasswordChanged(false);
      setConfigured(false);
      addToast("success", t("settings:notifications.smtpDeleted"));
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : t("settings:notifications.smtpDeleteFailed")
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    setTesting(true);
    try {
      const result = await adminApi.testSmtpConnection(config);
      if (result.success) {
        addToast("success", t("settings:notifications.testSuccess"));
      } else {
        addToast(
          "error",
          t("settings:notifications.testFailed", { error: result.error ?? "Unknown error" })
        );
      }
    } catch (error) {
      addToast(
        "error",
        t("settings:notifications.testFailed", {
          error: error instanceof Error ? error.message : "Unknown error",
        })
      );
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ color: "var(--text-muted)" }} className="text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-base" style={{ color: "var(--text-primary)" }}>
        {t("settings:notifications.smtpTitle")}
      </h3>


      {/* Enable toggle */}
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => handleChange("enabled", e.target.checked)}
          className="w-4 h-4"
        />
        <span style={{ color: "var(--text-primary)" }}>
          {t("settings:notifications.smtpEnabled")}
        </span>
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Host */}
        <div>
          <label className="label">{t("settings:notifications.smtpHost")}</label>
          <input
            type="text"
            className="input"
            value={config.host}
            onChange={(e) => handleChange("host", e.target.value)}
            placeholder="smtp.example.com"
          />
        </div>

        {/* Port */}
        <div>
          <label className="label flex items-center gap-1.5">
                {t("settings:notifications.smtpPort")}
                <HelpIcon content={t("settings:notifications.smtpHelp.ports")} position="top" />
              </label>
          <input
            type="number"
            className="input"
            value={config.port}
            min={1}
            max={65535}
            onChange={(e) => handleChange("port", parseInt(e.target.value, 10) || 587)}
          />
        </div>

        {/* Username */}
        <div>
          <label className="label">{t("settings:notifications.smtpUsername")}</label>
          <input
            type="text"
            className="input"
            value={config.username}
            onChange={(e) => handleChange("username", e.target.value)}
            autoComplete="off"
          />
        </div>

        {/* Password */}
        <div>
          <label className="label flex items-center gap-1.5">
                {t("settings:notifications.smtpPassword")}
                <HelpIcon content={t("settings:notifications.smtpHelp.credentials")} position="top" />
              </label>
          <input
            type="password"
            className="input"
            value={config.password}
            placeholder={passwordChanged ? "" : "••••••••"}
            onChange={(e) => handleChange("password", e.target.value)}
            autoComplete="new-password"
          />
        </div>

        {/* From Email */}
        <div>
          <label className="label flex items-center gap-1.5">
                {t("settings:notifications.smtpFromEmail")}
                <HelpIcon content={t("settings:notifications.smtpHelp.sender")} position="top" />
              </label>
          <input
            type="email"
            className="input"
            value={config.fromEmail}
            onChange={(e) => handleChange("fromEmail", e.target.value)}
            placeholder="noreply@example.com"
          />
        </div>

        {/* From Name */}
        <div>
          <label className="label">{t("settings:notifications.smtpFromName")}</label>
          <input
            type="text"
            className="input"
            value={config.fromName}
            onChange={(e) => handleChange("fromName", e.target.value)}
          />
        </div>
      </div>

      {/* Secure TLS */}
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={config.secure}
          onChange={(e) => handleChange("secure", e.target.checked)}
          className="w-4 h-4"
        />
        <span style={{ color: "var(--text-primary)" }}>
          {t("settings:notifications.smtpSecure")}
        </span>
      </label>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 pt-2">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void handleTest()}
          disabled={testing || saving || deleting}
        >
          {testing ? "Testing..." : t("settings:notifications.testConnection")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleSave()}
          disabled={saving || testing || deleting}
        >
          {saving ? "Saving..." : t("settings:notifications.save")}
        </button>
        {/* Only offered once something is actually stored (#255) — a delete on an
            empty instance would promise to undo a thing that never happened. */}
        {configured && (
          <button
            type="button"
            className="btn btn-danger sm:ml-auto"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={saving || testing || deleting}
          >
            {t("settings:notifications.smtpDelete")}
          </button>
        )}
      </div>

      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          void handleDelete();
        }}
        title={t("settings:notifications.smtpDeleteConfirm.title")}
        message={t("settings:notifications.smtpDeleteConfirm.message")}
        confirmText={t("settings:notifications.smtpDeleteConfirm.confirm")}
        cancelText={t("common:buttons.cancel")}
        confirmButtonClass="bg-red-600 hover:bg-red-700 focus:ring-red-500 text-white"
      />
    </div>
  );
}
