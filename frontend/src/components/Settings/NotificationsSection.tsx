import { SectionCard, SectionTitle } from "./SettingsShared";
import NotificationPreferences from "./NotificationPreferences";
import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";

export default function NotificationsSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:notifications.title")}
        description={t("settings:notifications.description")}
      />
      <InlineHelp
        title={t("settings:notifications.help.title")}
        category="basic"
        content={
          <div className="space-y-2">
            <p>{t("settings:notifications.help.description")}</p>
            <div>
              <p className="font-semibold">{t("settings:notifications.help.emailTitle")}</p>
              <p className="ml-2 text-sm">{t("settings:notifications.help.email")}</p>
            </div>
            <div>
              <p className="font-semibold">{t("settings:notifications.help.remindersTitle")}</p>
              <p className="ml-2 text-sm">{t("settings:notifications.help.reminders")}</p>
            </div>
            <div>
              <p className="font-semibold">{t("settings:notifications.help.privacyTitle")}</p>
              <p className="ml-2 text-sm">{t("settings:notifications.help.privacy")}</p>
            </div>
          </div>
        }
      />
      <NotificationPreferences />
    </SectionCard>
  );
}
