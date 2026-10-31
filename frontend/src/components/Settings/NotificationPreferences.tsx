import { useState, useEffect, useRef } from "react";
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
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "failed">("loading");

  // The last snapshot the server confirmed — rollback target and baseline for
  // the address field. A ref, because the writes below settle after renders.
  const confirmed = useRef<NotificationPreferences>(DEFAULT_PREFS);
  // One write in flight; edits made meanwhile merge into `queued` and go out
  // when it settles, so the server hears them in the order they were made.
  const inFlight = useRef(false);
  const queued = useRef<Partial<NotificationPreferences> | null>(null);

  const load = async (): Promise<void> => {
    setLoadState("loading");
    try {
      const data = await notificationsApi.getPreferences();
      confirmed.current = data;
      setPrefs(data);
      setLoadState("loaded");
    } catch (err) {
      // Not the defaults: showing "off" for switches that may be on, and then
      // saving over them, is the lie this state exists to avoid.
      setLoadState("failed");
      addToast("error", err instanceof Error ? err.message : t("settings:notifications.loadError"));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const send = async (patch: Partial<NotificationPreferences>): Promise<void> => {
    inFlight.current = true;
    try {
      const updated = await notificationsApi.updatePreferences(patch);
      confirmed.current = { ...confirmed.current, ...updated };
      // Only adopt the response when no newer edit is waiting: it would
      // otherwise flip the switch back until the next response lands.
      if (!queued.current) setPrefs(confirmed.current);
    } catch (error) {
      // A newer edit is on its way and decides; otherwise show what is stored.
      if (!queued.current) {
        setPrefs(confirmed.current);
        addToast(
          "error",
          error instanceof Error ? error.message : t("settings:notifications.saveFailed")
        );
      }
    } finally {
      inFlight.current = false;
      const next = queued.current;
      queued.current = null;
      if (next) void send(next);
    }
  };

  const save = (patch: Partial<NotificationPreferences>): void => {
    setPrefs((current) => ({ ...current, ...patch }));
    if (inFlight.current) {
      queued.current = { ...queued.current, ...patch };
      return;
    }
    void send(patch);
  };

  if (loadState === "loading") {
    return <p className="t-caption">{t("common:messages.loading")}</p>;
  }

  if (loadState === "failed") {
    return (
      <div role="alert">
        <p className="t-caption">{t("settings:notifications.loadError")}</p>
        <button type="button" className="btn-secondary" onClick={() => void load()}>
          {t("common:buttons.retry")}
        </button>
      </div>
    );
  }

  const email = (prefs.notificationEmail ?? "").trim();
  const commitEmail = (): void => {
    const value = email === "" ? null : email;
    if (value === confirmed.current.notificationEmail && !queued.current) return;
    save({ notificationEmail: value });
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
        onChange={(on) => save({ notifyBefore24h: on })}
        label={t("settings:notifications.before24h")}
        sub={t("settings:notifications.before24hSub")}
      />
      <Switch
        id="notify-2h"
        checked={prefs.notifyBefore2h}
        onChange={(on) => save({ notifyBefore2h: on })}
        label={t("settings:notifications.before2h")}
        sub={t("settings:notifications.before2hSub")}
      />
    </SettingRows>
  );
}
