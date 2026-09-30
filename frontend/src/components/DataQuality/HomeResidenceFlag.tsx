import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import type { HomeResidenceUnconfirmedDetails } from "../../types/dataQuality";

/** Where the question is answered: the "Zuhause" settings section. */
export const HOME_SETTINGS_PATH = "/settings?section=homeAirport";

/**
 * "Wohnort bestätigen und weitere Heimatflughäfen wählen?" — the one inbox
 * question an account migrated from the old one-airport home gets (owner
 * decision 2026-09-27). It is answered on the settings page, where every home
 * period is shown; confirming the last one closes the question on the next
 * check run. Nothing changes until then, and the card says so.
 */
export default function HomeResidenceFlag({
  details,
}: {
  details: HomeResidenceUnconfirmedDetails;
}): JSX.Element {
  const { t } = useTranslation(["dataQuality"]);
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
        {t("dataQuality:kinds.home_residence_unconfirmed.question")}
      </p>
      <p className="text-sm" style={{ color: "var(--text-primary)" }}>
        {t("dataQuality:kinds.home_residence_unconfirmed.body", {
          airports: details.airports.join(", "),
        })}
      </p>
      <Link to={HOME_SETTINGS_PATH} className="btn-primary inline-block">
        {t("dataQuality:kinds.home_residence_unconfirmed.action")}
      </Link>
    </div>
  );
}
