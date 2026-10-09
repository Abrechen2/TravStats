import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { minutesText } from "../../lib/flights/minutesText";
import { formatLocalClock, formatLocalDate } from "../../lib/displayFormat";
import { flightArrival, flightDeparture } from "../../lib/entityTimes";
import { flightTransfers, type FlightTransfer } from "../../lib/flights/flightTransfer";
import { clockOf, type TimeValue } from "../../shared/time";
import type { Flight } from "../../types";
import DetailSection from "../ui/DetailSection";
import { DAY_CARD_TOUCH } from "./FlightDayCard";
import type { FlightBookingState } from "./useFlightBooking";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const route = (f: Flight): string =>
  [f.depIata || f.depIcao, f.arrIata || f.arrIcao].filter(Boolean).join(" → ");

function when(value: TimeValue | null): string | null {
  if (!value) return null;
  const clock = clockOf(value);
  const day = formatLocalDate(value.local);
  return clock ? `${day} ${formatLocalClock(clock)}` : day;
}

/** The sentences for one gap. Never "reachable": only what the times and codes say. */
function transferLines(transfer: FlightTransfer, arrivingAt: string, t: Translate): string[] {
  if (transfer.kind === "separate") return [t("flights:itinerary.separate")];
  if (transfer.kind === "unknown" && transfer.reason === "order") {
    return [t("flights:itinerary.orderUnknown")];
  }
  const lines: string[] = [];
  if (transfer.kind === "transfer") {
    lines.push(
      t("flights:itinerary.transfer", {
        airport: arrivingAt,
        duration: minutesText(transfer.minutes, t),
      })
    );
  } else if (transfer.kind === "conflict") {
    lines.push(t("flights:itinerary.conflict", { duration: minutesText(transfer.minutes, t) }));
  } else {
    lines.push(t("flights:itinerary.timeUnknown", { airport: arrivingAt }));
  }
  const airport = transfer.airport;
  if (airport.kind === "change") {
    lines.push(
      airport.km === null
        ? t("flights:itinerary.airportChange", { from: airport.from, to: airport.to })
        : t("flights:itinerary.airportChangeKm", {
            from: airport.from,
            to: airport.to,
            km: airport.km,
          })
    );
  } else if (airport.kind === "unconfirmed") {
    lines.push(t("flights:itinerary.airportUnconfirmed"));
  }
  return lines;
}

function TransferNote({
  transfer,
  arrivingAt,
  index,
}: {
  transfer: FlightTransfer;
  arrivingAt: string;
  index: number;
}): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const conflict = transfer.kind === "conflict";
  return (
    <div
      data-testid={`itinerary-transfer-${index}`}
      className="t-caption flex flex-col"
      style={{
        gap: 2,
        margin: "6px 0 6px 12px",
        paddingLeft: 10,
        borderLeft: `2px ${conflict ? "solid" : "dashed"} var(${conflict ? "--ts-bad" : "--ts-border"})`,
      }}
    >
      {transferLines(transfer, arrivingAt, t).map((line) => (
        <span key={line} style={conflict ? { color: "var(--ts-bad)", fontWeight: 600 } : undefined}>
          {line}
        </span>
      ))}
    </div>
  );
}

function Segment({
  segment,
  index,
  current,
}: {
  segment: Flight;
  index: number;
  current: boolean;
}): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const dep = when(flightDeparture(segment));
  const arr = when(flightArrival(segment));
  const title = `${index + 1}. ${route(segment) || t("common:labels.unknown")}`;
  const caption = [segment.flightNumber, [dep, arr].filter(Boolean).join(" – ")]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex min-w-0 flex-col" style={{ gap: 2 }}>
      {current ? (
        <span aria-current="page" style={{ fontWeight: 700, color: "var(--ts-text-bright)" }}>
          {title}{" "}
          <span className="t-caption" style={{ fontWeight: 600 }}>
            {t("flights:itinerary.thisFlight")}
          </span>
        </span>
      ) : (
        // Each segment keeps its own page one tap away (forgejo#218).
        <Link
          to={`/flights/${segment.id}`}
          className={`inline-flex items-center underline underline-offset-4 ${DAY_CARD_TOUCH}`}
          style={{ fontWeight: 700, color: "var(--ts-accent)" }}
        >
          {title}
        </Link>
      )}
      {caption ? (
        <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
          {caption}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The booking as one journey (forgejo#218): every flight LINKED to the same
 * booking, in order, with the change between two of them — the wait, a
 * change of airport, a conflict, or an honest "unknown". A flight that only
 * shares a PNR string is not here; the server returns linked segments only.
 * Drawn when the booking has more than this one flight.
 */
export default function BookingItinerary({
  flightId,
  state,
  onRetry,
}: {
  flightId: string;
  state: FlightBookingState;
  onRetry: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["flights", "common"]);
  if (state.kind === "none" || state.kind === "loading") return null;
  if (state.kind === "failed") {
    return (
      <DetailSection title={t("flights:itinerary.title")}>
        <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
          <p role="alert" className="t-caption">
            {t("flights:itinerary.loadFailed")}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className={`btn-secondary px-2 py-1 text-xs ${DAY_CARD_TOUCH}`}
          >
            {t("common:buttons.retry")}
          </button>
        </div>
      </DetailSection>
    );
  }
  const { booking, segments } = state.answer;
  if (!booking || segments.length < 2) return null;
  const transfers = flightTransfers(segments);
  return (
    <DetailSection
      title={t("flights:itinerary.title")}
      aside={booking.pnr ? t("flights:itinerary.pnr", { pnr: booking.pnr }) : undefined}
    >
      <ol className="flex flex-col" data-testid="booking-itinerary">
        {segments.map((segment, i) => (
          <li key={segment.id}>
            {i > 0 ? (
              <TransferNote
                transfer={transfers[i - 1]}
                arrivingAt={segments[i - 1].arrIata || segments[i - 1].arrIcao || "?"}
                index={i}
              />
            ) : null}
            <Segment segment={segment} index={i} current={segment.id === flightId} />
          </li>
        ))}
      </ol>
      <p className="t-caption" style={{ marginTop: 8 }}>
        {t("flights:itinerary.noReachabilityClaim")}
      </p>
    </DetailSection>
  );
}
