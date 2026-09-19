import { useState, useEffect } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { notificationsApi, type NotificationPreferences } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { Switch } from "../ui/Field";
import { SettingRow, SettingRows } from "../ui/SettingRow";

const DEFAULT_PREFS: NotificationPreferences = {
  notificationEmail: null,
  notifyBefore24h: false,
  notifyBefore2h: false,
};

/**
 * Notification switches, saved as they change.
 *
 * Round 4 (decision E10) removed the save button from settings: a switch that
 * looks on but is not stored until a button further down is pressed was the
 * one way to lose a change here. A toggle writes at once; the address writes
 * when the field is left. A failed write restores what the server holds, so
 * the screen never shows a state that is not saved.
 */
export default function NotificationPreferences(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const addToast = useToastStore((state) => state.addToast);

  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFS);
  const [saved, setSaved] = useState<NotificationPreferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const data = await notificationsApi.getPreferences();
        setPrefs(data);
        setSaved(data);
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

  const save = async (patch: Partial<NotificationPreferences>): Promise<void> => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      const updated = await notificationsApi.updatePreferences(patch);
      setPrefs((current) => ({ ...current, ...updated }));
      setSaved(updated);
    } catch (error) {
      setPrefs(saved);
      addToast(
        "error",
        error instanceof Error ? error.message : t("settings:notifications.saveFailed")
      );
    }
  };

  if (loading) {
    return <p className="t-caption">{t("common:messages.loading")}</p>;
  }

  const email = (prefs.notificationEmail ?? "").trim();
  const commitEmail = (): void => {
    const value = email === "" ? null : email;
    if (value === saved.notificationEmail) return;
    void save({ notificationEmail: value });
  };

  return (
    <SettingRows>
      <SettingRow
        title={t("settings:notifications.email")}
        sub={t("settings:notifications.emailSub")}
        htmlFor="notification-email"
        control={
          <input
            id="notification-email"
            type="email"
            className="input"
            style={{ minWidth: 240 }}
            value={prefs.notificationEmail ?? ""}
            onChange={(e) => setPrefs((prev) => ({ ...prev, notificationEmail: e.target.value }))}
            onBlur={commitEmail}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEmail();
            }}
            placeholder="name@example.com"
          />
        }
      />
      <Switch
        id="notify-24h"
        checked={prefs.notifyBefore24h}
        onChange={(on) => void save({ notifyBefore24h: on })}
        label={t("settings:notifications.before24h")}
        sub={t("settings:notifications.before24hSub")}
      />
      <Switch
        id="notify-2h"
        checked={prefs.notifyBefore2h}
        onChange={(on) => void save({ notifyBefore2h: on })}
        label={t("settings:notifications.before2h")}
        sub={t("settings:notifications.before2hSub")}
      />
    </SettingRows>
  );
}
