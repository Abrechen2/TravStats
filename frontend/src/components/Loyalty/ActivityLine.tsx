import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { formatDate } from "../../lib/displayFormat";
import type { LoyaltyDomain } from "../../shared/domains";
import type { MembershipActivity } from "../../types/loyalty";
import { loyaltyListLink } from "./LoyaltyListFilter";

interface Props {
  domain: LoyaltyDomain;
  activity: MembershipActivity | null | undefined;
  /** The card, for the links to the rows a figure counts. Absent: no links. */
  membershipId?: string;
}

const LINK_STYLE = { color: "var(--ts-accent)", fontWeight: 600 } as const;

/**
 * "12 Flüge · zuletzt 02.01.2025", then the same per year — the evaluation the
 * tester asked for: "Nächte/Aufenthalte pro Programm … Vielleicht ein Link zu
 * einer Liste all dieser Nächte/Aufenthalte" (Discord, 2026-09-26).
 *
 * The figures come from the server, derived by the statistics' counting rules;
 * this only words them. A part the server abstained on (null nights, no dated
 * activity) is left out rather than printed as 0. Each figure of a hotel or
 * flight card links to the list filtered to exactly the rows it counted; the
 * cruise list has no such filter, so a cruise card's figures are text.
 */
export default function ActivityLine({
  domain,
  activity,
  membershipId,
}: Props): JSX.Element | null {
  const { t } = useTranslation(["loyalty"]);
  if (!activity) return null;
  if (activity.count === 0) {
    return (
      <p className="t-caption" data-testid="loyalty-activity">
        {t("loyalty:activity.none")}
      </p>
    );
  }

  const figures = (count: number, nights: number | null): string[] => {
    const parts = [t(`loyalty:activity.${domain}`, { count })];
    if (nights !== null) parts.push(t("loyalty:activity.nights", { count: nights }));
    return parts;
  };
  const parts = figures(activity.count, activity.nights);
  // A calendar day from the server, pinned to UTC so a reader west of
  // Greenwich is not shown the day before.
  if (activity.lastActivity) {
    parts.push(
      t("loyalty:activity.last", { date: formatDate(activity.lastActivity, { timeZone: "UTC" }) })
    );
  }
  const listDomain = domain === "lodging" || domain === "flight" ? domain : null;
  const linkTo = (year?: number): string | null =>
    listDomain !== null && membershipId !== undefined
      ? loyaltyListLink(listDomain, membershipId, year)
      : null;
  const allLink = linkTo();
  const years = activity.years ?? [];

  return (
    <div className="t-caption" data-testid="loyalty-activity">
      <p>
        {parts.join(" · ")}
        {allLink !== null && (
          <>
            {" · "}
            <Link
              to={allLink}
              data-testid="loyalty-activity-list"
              className="hover:underline"
              style={LINK_STYLE}
            >
              {t(`loyalty:activity.showList.${domain}`)}
            </Link>
          </>
        )}
      </p>
      {years.length > 0 && (
        <ul
          className="mt-1 flex flex-wrap gap-x-4 gap-y-1"
          aria-label={t("loyalty:activity.byYear")}
        >
          {years.map((row) => {
            const text = `${row.year}: ${figures(row.count, row.nights).join(" · ")}`;
            const yearLink = linkTo(row.year);
            return (
              <li key={row.year} data-testid={`loyalty-activity-year-${row.year}`}>
                {yearLink !== null ? (
                  <Link to={yearLink} className="hover:underline" style={LINK_STYLE}>
                    {text}
                  </Link>
                ) : (
                  text
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
