import { SectionCard, SectionTitle } from "./SettingsShared";
import NotificationPreferences from "./NotificationPreferences";
import { useTranslation } from "../../hooks/useTranslation";

export default function NotificationsSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:notifications.title")}
        description={t("settings:notifications.description")}
      />
      <NotificationPreferences />
    </SectionCard>
  );
}
