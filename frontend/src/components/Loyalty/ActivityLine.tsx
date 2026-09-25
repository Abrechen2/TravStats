import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatDate } from "../../lib/displayFormat";
import type { LoyaltyDomain } from "../../shared/domains";
import type { MembershipActivity } from "../../types/loyalty";

interface Props {
  domain: LoyaltyDomain;
  activity: MembershipActivity | null | undefined;
}

/**
 * "12 Flüge · zuletzt 02.01.2025" — what the logbook says the card was used
 * for. The figures come from the server, derived by the statistics' counting
 * rules; this only words them. A part the server abstained on (null nights,
 * no dated activity) is left out rather than printed as 0.
 */
export default function ActivityLine({ domain, activity }: Props): JSX.Element | null {
  const { t } = useTranslation(["loyalty"]);
  if (!activity) return null;
  if (activity.count === 0) {
    return (
      <p className="t-caption" data-testid="loyalty-activity">
        {t("loyalty:activity.none")}
      </p>
    );
  }
  const parts = [t(`loyalty:activity.${domain}`, { count: activity.count })];
  if (activity.nights !== null)
    parts.push(t("loyalty:activity.nights", { count: activity.nights }));
  // A calendar day from the server, pinned to UTC so a reader west of
  // Greenwich is not shown the day before.
  if (activity.lastActivity) {
    parts.push(
      t("loyalty:activity.last", { date: formatDate(activity.lastActivity, { timeZone: "UTC" }) })
    );
  }
  return (
    <p className="t-caption" data-testid="loyalty-activity">
      {parts.join(" · ")}
    </p>
  );
}
