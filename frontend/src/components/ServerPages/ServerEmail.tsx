import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import Button from "../ui/Button";
import { ErrorLine } from "../ui/settings";
import MailIntakeAdminCard from "../MailIntake/MailIntakeAdminCard";
import SmtpRows from "../Services/SmtpRows";
import { ServicesProvider, useServices } from "../Services/servicesContext";

function Body(): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const { admin } = useServices();
  const service = admin?.data?.categories.flatMap((c) => c.services).find((s) => s.id === "smtp");
  if (admin?.loadError && !admin.data) {
    return (
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
        <ErrorLine>{t("settingsRows:services.ui.serverLoadFailed")}</ErrorLine>
        <Button variant="secondary" onClick={() => void admin.reload()}>
          {t("settingsRows:services.ui.retry")}
        </Button>
      </div>
    );
  }
  if (!service) return <p className="t-caption">{t("settingsRows:services.ui.loading")}</p>;
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <SmtpRows service={service} />
      <MailIntakeAdminCard />
    </div>
  );
}

/**
 * Server › E-Mail (settings v3 S5): the mail server that sends invitations,
 * reminders and new passwords, with the check and its last verdict. It was a
 * card of the service catalogue.
 */
export default function ServerEmail(): JSX.Element {
  return (
    <ServicesProvider isAdmin>
      <Body />
    </ServicesProvider>
  );
}
