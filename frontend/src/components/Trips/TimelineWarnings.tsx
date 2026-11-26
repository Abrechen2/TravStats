import { Icon } from "../ui/Icon";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import type { TimelineEvent } from "../../lib/tripTimelineEvents";
import type { TimelineFinding } from "../../lib/tripTimelinePlausibility";

/** Where the entry behind a timeline row is edited, or null where the row has no page of its own. */
export function editPathOf(ev: TimelineEvent): string | null {
  switch (ev.kind) {
    case "flight":
      return `/flights/${ev.flight.id}`;
    case "rail":
      return `/rail/${ev.journey.id}`;
    case "bus":
      return `/bus/${ev.ride.id}`;
    case "ferry":
      return `/ferry/${ev.ride.id}`;
    case "rental-pickup":
    case "rental-return":
      return `/rentals/${ev.rental.id}`;
    case "lodging-checkin":
    case "lodging-checkout":
      return `/lodging/${ev.stay.lodgingId}`;
    default:
      return null;
  }
}

/**
 * One line per finding under an entry (forgejo#426): the reason, and a link to
 * the entry to correct. The entry itself is neither moved nor changed.
 */
export function TimelineWarnings({
  ev,
  findings,
}: {
  ev: TimelineEvent;
  findings: readonly TimelineFinding[] | undefined;
}): JSX.Element | null {
  const { t } = useTranslation();
  if (!findings || findings.length === 0) return null;
  const path = editPathOf(ev);
  return (
    <ul
      className="mt-1 flex flex-col gap-1"
      style={{ listStyle: "none", margin: 0, padding: 0 }}
      data-testid="timeline-warnings"
    >
      {findings.map((f) => (
        <li
          key={`${f.code}-${f.otherEventId}`}
          className="flex flex-wrap items-center gap-x-3 rounded-lg px-3 py-1.5 text-xs"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--color-warning, var(--color-border))",
            color: "var(--text-muted)",
          }}
        >
          <span role="note">
            <Icon name="triangle-alert" size={14} className="mr-1 inline" />
            {t(`trips:detail.plausibility.${f.code}`)}
          </span>
          {path && (
            <Link to={path} className="underline" style={{ color: "var(--accent)" }}>
              {t("trips:detail.plausibility.edit")}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
