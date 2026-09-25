import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatStationClock, formatStationTime } from "../../lib/railTime";
import type { RailJourney } from "../../types/rail";
import { Icon } from "../ui/Icon";

interface Props {
  journey: RailJourney;
  onEdit: (journey: RailJourney) => void;
  onDelete: (journey: RailJourney) => void;
}

/** "ICE 578 · DB Fernverkehr" — whatever of the three is known, nothing invented. */
export function trainLabel(journey: RailJourney): string {
  const train = [journey.trainCategory, journey.trainNumber].filter(Boolean).join(" ");
  return [train, journey.operator].filter(Boolean).join(" · ");
}

/**
 * One train ride in the logbook. Times are shown on each station's clock,
 * never the reader's; a measured distance says it is a straight line, because
 * it understates the track and a reader must not take it for the ticket's.
 * Actions are real buttons, not a clickable row — a clickable row swallows
 * the clicks of the buttons inside it.
 */
export function RailJourneyRow({ journey, onEdit, onDelete }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["rail"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const label = trainLabel(journey);
  const km =
    journey.distanceKm === null
      ? null
      : `${Math.round(journey.distanceKm).toLocaleString(locale)} km${
          journey.distanceSource === "great_circle" ? ` (${t("rail:straightLine")})` : ""
        }`;
  const delay =
    journey.delayMinutes === null
      ? null
      : journey.delayMinutes > 0
        ? t("rail:delay", { minutes: journey.delayMinutes })
        : t("rail:onTime");

  const details = [
    `${formatStationTime(journey.departureTime, journey.depTimezone, locale)}${
      journey.arrivalTime
        ? ` – ${formatStationClock(journey.arrivalTime, journey.arrTimezone, locale)}`
        : ""
    }`,
    label,
    km,
    delay,
  ].filter((part): part is string => Boolean(part));

  return (
    <li
      data-testid={`rail-row-${journey.id}`}
      className="flex flex-wrap items-start justify-between gap-3 py-3"
      style={{ borderBottom: "1px solid var(--ts-border)" }}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span style={{ color: "var(--ts-domain-rail)" }}>
          <Icon name="train-front" size={20} />
        </span>
        <div className="min-w-0">
          <div className="font-semibold">
            {journey.depStationName} → {journey.arrStationName}
          </div>
          <div className="t-caption">{details.join(" · ")}</div>
          {journey.trip ? <div className="t-caption">{journey.trip.name}</div> : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="t-caption" data-testid="rail-status">
          {t(`rail:status.${journey.status}`)}
        </span>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 text-sm"
          onClick={(): void => onEdit(journey)}
        >
          {t("rail:edit")}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 text-sm"
          onClick={(): void => onDelete(journey)}
        >
          {t("rail:delete")}
        </button>
      </div>
    </li>
  );
}
