import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import type { UpcomingEntry } from "../../lib/api/upcoming";

const DOMAIN_ICON: Record<UpcomingEntry["domain"], string> = {
  flight: "✈",
  cruise: "⚓",
  lodging: "🏨",
  poi: "📍",
  trip: "🧳",
};

/** Where a click goes: the trip when the entry belongs to one, else that domain's own list. */
const DOMAIN_ROUTE: Record<UpcomingEntry["domain"], string> = {
  flight: "/flights",
  cruise: "/cruises",
  lodging: "/lodging",
  poi: "/",
  trip: "/trips",
};

interface NextUpEntryProps {
  entry: UpcomingEntry;
  /** Now, as a timestamp — passed in so the countdown is testable without faking the clock. */
  nowMs: number;
}

/**
 * The "next up" line at the right end of the dashboard's domain strip.
 *
 * It replaces a card that floated over the bottom-left of the map and covered
 * the map-mode switcher completely — measured at 232×39 px, i.e. the whole
 * control (reported 2026-08-14). The strip has free space, nothing lies under
 * it, and the entry now sits next to the domain it belongs to.
 */
export function NextUpEntry({ entry, nowMs }: NextUpEntryProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const navigate = useNavigate();

  const msAhead = new Date(entry.startsAt).getTime() - nowMs;
  const daysAhead = Math.floor(msAhead / 86_400_000);
  const hoursAhead = Math.floor(msAhead / 3_600_000);
  // Glanceable, not precise: days out at range, hours on the last day, "today"
  // inside it. Minute precision would need the departure airport's timezone,
  // which this line does not resolve — and does not need to.
  const countdown =
    daysAhead >= 1
      ? t("dashboard:nextUp.inDays", { count: daysAhead })
      : hoursAhead >= 1
        ? t("dashboard:nextUp.inHours", { count: hoursAhead })
        : t("dashboard:nextUp.today");

  return (
    <button
      type="button"
      data-testid="next-up-entry"
      onClick={() => navigate(entry.tripId ? `/trips/${entry.tripId}` : DOMAIN_ROUTE[entry.domain])}
      title={entry.secondary ? `${entry.primary} · ${entry.secondary}` : entry.primary}
      style={{
        marginLeft: "auto",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        maxWidth: "42%",
        padding: "6px 10px",
        background: "transparent",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        color: "var(--text-primary)",
        cursor: "pointer",
        fontSize: "12px",
        overflow: "hidden",
      }}
    >
      <span aria-hidden style={{ opacity: 0.8 }}>
        {DOMAIN_ICON[entry.domain]}
      </span>
      <span style={{ color: "var(--accent)", fontWeight: 600, whiteSpace: "nowrap" }}>
        {t("dashboard:nextUp.label")} · {countdown}
      </span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {entry.primary}
      </span>
      {entry.tripName && (
        <span
          data-testid="next-up-trip"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "1px 6px",
            borderRadius: 999,
            background: "rgba(240,169,71,0.13)",
            color: "var(--accent)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          🧳 {entry.tripName}
        </span>
      )}
      {entry.secondary && (
        <span
          style={{
            opacity: 0.65,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.secondary}
        </span>
      )}
    </button>
  );
}
