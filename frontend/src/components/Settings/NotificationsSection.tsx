import { SectionCard, SectionTitle } from "./SettingsShared";
import NotificationPreferences from "./NotificationPreferences";
import DemoLockedNotice from "./DemoLockedNotice";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";

export default function NotificationsSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:notifications.title")}
        description={t("settings:notifications.description")}
      />
      {/* Not a preference on the shared account: whoever writes the address
          can ask for a password-reset link to their own inbox and lock every
          other visitor out, which is why the server refuses the write. The
          preferences are not even fetched — there is nothing here that
          belongs to the person reading it. */}
      {isDemo ? <DemoLockedNotice /> : <NotificationPreferences />}
    </SectionCard>
  );
}
