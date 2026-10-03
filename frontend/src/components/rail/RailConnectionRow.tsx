import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { formatRailSpan } from "../../lib/railTime";
import {
  connectionDurationMinutes,
  connectionSpan,
  connectionStations,
  connectionStatus,
  connectionTrains,
} from "../../lib/rail/railConnection";
import { formatRailDuration } from "../../lib/rail/railDuration";
import type { RailConnection, RailJourney } from "../../types/rail";
import { Icon } from "../ui/Icon";
import { RailJourneyRow } from "./RailJourneyRow";

interface Props {
  connection: RailConnection;
  onEdit: (journey: RailJourney) => void;
  onDelete: (journey: RailJourney) => void;
}

/**
 * One entry of the rail logbook (forgejo#187). A direct ride is drawn exactly
 * as before, by `RailJourneyRow`. A ride with changes is ONE row: start, every
 * station changed at, destination; first departure to last arrival; the whole
 * time on the way; the trains. It links to the connection's page, where each
 * train links on to its own — editing and deleting stay per train, there.
 *
 * No distance: the legs' figures may mix a straight line with a traced one,
 * and a sum would pass the mix off as one measurement (`railSummaryFigures`
 * leaves it out for the same reason).
 */
export function RailConnectionRow({ connection, onEdit, onDelete }: Props): JSX.Element | null {
  const { t, i18n } = useTranslation(["rail"]);
  const { legs } = connection;
  if (legs.length === 0) return null;
  if (legs.length === 1) {
    return <RailJourneyRow journey={legs[0]} onEdit={onEdit} onDelete={onDelete} />;
  }

  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const span = connectionSpan(legs);
  const duration = connectionDurationMinutes(legs);
  const status = connectionStatus(legs);
  const trip = legs.every((leg) => leg.trip && leg.trip.id === legs[0].trip?.id)
    ? legs[0].trip
    : null;
  const details = [
    span ? formatRailSpan(span, locale) : "",
    duration !== null ? formatRailDuration(duration, t) : "",
    connectionTrains(legs).join(" · "),
    t("rail:connection.changes", { count: legs.length - 1 }),
  ].filter((part) => part !== "");
  const to = `/rail/connection/${connection.id}`;

  return (
    <li
      data-testid={`rail-connection-row-${connection.id}`}
      className="flex flex-wrap items-start justify-between gap-3 py-3"
      style={{ borderBottom: "1px solid var(--ts-border)" }}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span style={{ color: "var(--ts-domain-rail)" }}>
          <Icon name="train-front" size={20} />
        </span>
        <div className="min-w-0">
          <Link to={to} className="font-semibold hover:underline">
            {connectionStations(legs).join(" → ")}
          </Link>
          <div className="t-caption">{details.join(" · ")}</div>
          {trip ? <div className="t-caption">{trip.name}</div> : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {status && (
          <span className="t-caption" data-testid="rail-status">
            {t(`rail:status.${status}`)}
          </span>
        )}
        <Link to={to} className="rounded-md border border-border px-3 py-1 text-sm">
          {t("rail:connection.open")}
        </Link>
      </div>
    </li>
  );
}
