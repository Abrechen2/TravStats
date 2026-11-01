import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { SettingItem } from "../ui/settings";
import AirlineLogoRefreshButton from "../Admin/AirlineLogoRefreshButton";
import type { AdminService } from "../../lib/api/externalServices";
import DawarichServerRows from "./DawarichServerRows";
import FederationRows from "./FederationRows";
import OllamaRows from "./OllamaRows";
import PushRows from "./PushRows";
import SmtpRows from "./SmtpRows";
import UsageStatsRows from "./UsageStatsRows";
import type { ServiceCardDef } from "./serviceCards";

/** Services whose "on" switch is a row of their own (it carries a consent or a question). */
const OWN_SWITCH = new Set(["smtp", "push", "federation", "usageStats"]);
/** Services whose credential group is drawn by their own rows. */
const OWN_FIELDS = new Set(["smtp", "federation", "push"]);

export const ownsEnabledSwitch = (id: string): boolean => OWN_SWITCH.has(id);
export const ownsFields = (id: string): boolean => OWN_FIELDS.has(id);

/** "Logos neu laden" belongs to the service that serves them (Logostream). */
function LogosReload(): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  return (
    <SettingItem
      title={t("settingsRows:services.rows.logorefresh.t")}
      sub={t("settingsRows:services.rows.logorefresh.s")}
      scope="allAccounts"
      control={<AirlineLogoRefreshButton />}
    />
  );
}

/** The rows a service needs beyond the catalogue's switch, fields and test. */
export function ServerExtras({
  card,
  service,
}: {
  card: ServiceCardDef;
  service: AdminService | undefined;
}): JSX.Element | null {
  switch (card.id) {
    case "smtp":
      return service ? <SmtpRows service={service} /> : null;
    case "push":
      return <PushRows />;
    case "federation":
      return <FederationRows />;
    case "usageStats":
      return <UsageStatsRows />;
    case "dawarich":
      return <DawarichServerRows />;
    case "ollama":
      return service ? <OllamaRows service={service} /> : null;
    case "logos":
      return <LogosReload />;
    default:
      return null;
  }
}
