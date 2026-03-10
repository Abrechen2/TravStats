import { useState, useEffect } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { notificationsApi, type NotificationPreferences } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";

const DEFAULT_PREFS: NotificationPreferences = {
  notificationEmail: null,
  notifyBefore24h: false,
  notifyBefore2h: false,
};

export default function NotificationPreferences(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const addToast = useToastStore((state) => state.addToast);

  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const data = await notificationsApi.getPreferences();
        setPrefs(data);
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

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const updated = await notificationsApi.updatePreferences(prefs);
      setPrefs(updated);
      addToast("success", t("settings:notifications.saved"));
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Failed to save notification preferences"
      );
    } finally {
      setSaving(false);
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
      {/* Notification email */}
      <div>
        <label className="label">{t("settings:notifications.email")}</label>
        <input
          type="email"
          className="input"
          value={prefs.notificationEmail ?? ""}
          onChange={(e) =>
            setPrefs((prev) => ({
              ...prev,
              notificationEmail: e.target.value.trim() === "" ? null : e.target.value,
            }))
          }
          placeholder="your@email.com"
        />
      </div>

      {/* 24h checkbox */}
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          className="w-4 h-4"
          checked={prefs.notifyBefore24h}
          onChange={(e) => setPrefs((prev) => ({ ...prev, notifyBefore24h: e.target.checked }))}
        />
        <span style={{ color: "var(--text-primary)" }}>
          {t("settings:notifications.before24h")}
        </span>
      </label>

      {/* 2h checkbox */}
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          className="w-4 h-4"
          checked={prefs.notifyBefore2h}
          onChange={(e) => setPrefs((prev) => ({ ...prev, notifyBefore2h: e.target.checked }))}
        />
        <span style={{ color: "var(--text-primary)" }}>{t("settings:notifications.before2h")}</span>
      </label>

      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void handleSave()}
        disabled={saving}
      >
        {saving ? "Saving..." : t("settings:notifications.save")}
      </button>
    </div>
  );
}
