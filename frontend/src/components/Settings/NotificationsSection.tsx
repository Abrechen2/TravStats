import { AmberToggle, SectionCard, SectionTitle } from "./SettingsShared";
import NotificationPreferences from "./NotificationPreferences";
import { useTranslation } from "../../hooks/useTranslation";
import type { NotificationSettings } from "../../store/settingsStore";

interface NotificationsSectionProps {
  notifications: NotificationSettings;
  onSetNotifications: (partial: Partial<NotificationSettings>) => void;
}

export default function NotificationsSection({
  notifications,
  onSetNotifications,
}: NotificationsSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:notifications.title")}
        description={t("settings:notifications.description")}
      />
      <div className="space-y-3">
        <label className="flex items-center gap-3">
          <AmberToggle
            checked={notifications.emailNotifications}
            onChange={(e) => onSetNotifications({ emailNotifications: e.target.checked })}
          />
          <span style={{ color: "var(--text-primary)" }}>
            {t("settings:notifications.emailNotifications")}
          </span>
        </label>
        <label className="flex items-center gap-3">
          <AmberToggle
            checked={notifications.checkInReminder}
            onChange={(e) => onSetNotifications({ checkInReminder: e.target.checked })}
          />
          <span style={{ color: "var(--text-primary)" }}>
            {t("settings:notifications.checkInReminder")}
          </span>
        </label>
        <div>
          <label className="label">{t("settings:notifications.flightReminder")}</label>
          <select
            value={notifications.flightReminder}
            onChange={(e) =>
              onSetNotifications({
                flightReminder: e.target.value as typeof notifications.flightReminder,
              })
            }
            className="input"
          >
            <option value="off">{t("settings:notifications.options.off")}</option>
            <option value="24h">{t("settings:notifications.options.24h")}</option>
            <option value="48h">{t("settings:notifications.options.48h")}</option>
          </select>
        </div>
        <label className="flex items-center gap-3">
          <AmberToggle
            checked={notifications.featureUpdates}
            onChange={(e) => onSetNotifications({ featureUpdates: e.target.checked })}
          />
          <span style={{ color: "var(--text-primary)" }}>
            {t("settings:notifications.featureUpdates")}
          </span>
        </label>
      </div>
      <hr style={{ borderColor: "var(--border-color)", margin: "1.5rem 0" }} />
      <NotificationPreferences />
    </SectionCard>
  );
}
