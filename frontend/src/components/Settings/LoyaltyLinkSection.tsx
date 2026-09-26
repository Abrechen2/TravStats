import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import type { LoyaltyDomain } from "../../shared/domains";
import { SectionCard, SectionTitle } from "./SettingsShared";

interface Props {
  domain: LoyaltyDomain;
}

/**
 * Where a domain's settings used to hold its loyalty cards, a pointer to the
 * loyalty page's section for that domain.
 *
 * Until 2.7 the hotel cards were edited here, in full. The loyalty page holds
 * every domain's cards now, and a second full editor of the same cards in
 * Settings would be two places that can disagree about what a card covers.
 * The entry stays, per domain, because this is where a tester went looking
 * for them ("getrennt in dem jeweiligen Bereich der Einstellungen", Discord
 * 2026-08-08) — and old links to `?section=lodgingMemberships` land here.
 */
export default function LoyaltyLinkSection({ domain }: Props): JSX.Element {
  const { t } = useTranslation(["settings", "loyalty"]);
  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:memberships.title")}
        description={t("loyalty:settingsLink.description")}
      />
      <Link
        to={`/loyalty#${domain}`}
        data-testid={`loyalty-link-${domain}`}
        className="btn-secondary inline-block"
      >
        {t("loyalty:settingsLink.open")}
      </Link>
    </SectionCard>
  );
}
