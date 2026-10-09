import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { flightBookingApi } from "../../lib/api/flightBooking";
import { logger } from "../../lib/logger";
import { isTransientSaveError, saveErrorKey } from "../../lib/saveErrorMessage";
import { formatAmount } from "../../lib/units";
import { isAmountRecorded } from "../../shared/flightPricing";
import type { Flight } from "../../types";
import type { FlightBookingAnswer } from "../../types/flightBooking";
import { DAY_CARD_TOUCH } from "./FlightDayCard";

/** The split refusals the server names, each to its own sentence. */
const SPLIT_ERROR_KEYS: Readonly<Record<string, string>> = {
  BOOKING_PRICE_MISSING: "flights:bookingPrice.errors.priceMissing",
  BOOKING_SPLIT_SINGLE_SEGMENT: "flights:bookingPrice.errors.single",
  BOOKING_SPLIT_MIXED: "flights:bookingPrice.errors.mixed",
  BOOKING_SPLIT_DISTANCE_UNKNOWN: "flights:bookingPrice.errors.distanceUnknown",
  BOOKING_NOT_FOUND: "flights:bookingPrice.errors.noBooking",
};

const route = (f: Flight): string =>
  [f.depIata || f.depIcao, f.arrIata || f.arrIcao].filter(Boolean).join(" → ");

type Action = "equal" | "distance" | "remove";

function SplitControls({
  flight,
  answer,
  onAnswer,
}: {
  flight: Flight;
  answer: FlightBookingAnswer;
  onAnswer: (answer: FlightBookingAnswer) => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["flights", "common"]);
  const [busy, setBusy] = useState<Action | null>(null);
  const [failure, setFailure] = useState<{ key: string; action: Action } | null>(null);
  const booking = answer.booking!;
  const split = booking.split;
  const money = (value: number): string =>
    formatAmount(value, booking.currency, { language: i18n.language });

  const run = async (action: Action): Promise<void> => {
    if (busy) return;
    setBusy(action);
    setFailure(null);
    try {
      onAnswer(
        action === "remove"
          ? await flightBookingApi.removeSplit(flight.id)
          : await flightBookingApi.split(flight.id, action)
      );
    } catch (err: unknown) {
      logger.warn({ err }, "BookingPrice: split failed");
      setFailure({
        key: saveErrorKey(err, "flights:bookingPrice.errors.generic", SPLIT_ERROR_KEYS),
        action,
      });
    } finally {
      setBusy(null);
    }
  };

  const byId = new Map(answer.segments.map((s, i) => [s.id, { segment: s, index: i }]));
  const shareSum = split ? split.shares.reduce((a, s) => a + s.amount, 0) : 0;
  const button = `btn-secondary px-3 py-1 text-xs ${DAY_CARD_TOUCH}`;
  return (
    <div className="flex flex-col" style={{ gap: 8 }} data-testid="booking-split">
      <h3 className="t-label-mono">{t("flights:bookingPrice.splitTitle")}</h3>
      <p className="t-caption">{t("flights:bookingPrice.splitDisplayOnly")}</p>
      {split ? (
        <>
          {split.staleReason ? (
            <p
              role="status"
              className="t-caption"
              style={{ color: "var(--ts-warn)", fontWeight: 600 }}
            >
              {t(`flights:bookingPrice.stale.${split.staleReason}`)}
            </p>
          ) : null}
          <ul className="flex flex-col" style={{ gap: 2 }}>
            {split.shares.map((share) => {
              const found = byId.get(share.flightId);
              const label = found
                ? `${found.index + 1}. ${route(found.segment)}`
                : t("flights:bookingPrice.removedSegment");
              return (
                <li key={share.flightId} className="flex justify-between" style={{ gap: 12 }}>
                  <span style={share.flightId === flight.id ? { fontWeight: 700 } : undefined}>
                    {label}
                    {share.flightId === flight.id ? ` ${t("flights:itinerary.thisFlight")}` : ""}
                  </span>
                  <span style={{ fontFamily: "var(--ts-font-mono)" }}>{money(share.amount)}</span>
                </li>
              );
            })}
          </ul>
          <p className="t-caption" data-testid="booking-split-sum">
            {t("flights:bookingPrice.splitSum", {
              sum: money(shareSum),
              total: money(split.price),
              method: t(`flights:bookingPrice.method.${split.method}`),
            })}
          </p>
        </>
      ) : null}
      <div className="flex flex-wrap" style={{ gap: 8 }}>
        <button
          type="button"
          className={button}
          disabled={busy !== null}
          onClick={() => void run("equal")}
        >
          {busy === "equal" ? t("common:buttons.saving") : t("flights:bookingPrice.splitEqual")}
        </button>
        <button
          type="button"
          className={button}
          disabled={busy !== null}
          onClick={() => void run("distance")}
        >
          {busy === "distance"
            ? t("common:buttons.saving")
            : t("flights:bookingPrice.splitDistance")}
        </button>
        {split ? (
          <button
            type="button"
            className={button}
            disabled={busy !== null}
            onClick={() => void run("remove")}
          >
            {t("flights:bookingPrice.splitRemove")}
          </button>
        ) : null}
      </div>
      {failure ? (
        <div
          role="alert"
          className="flex flex-wrap items-center t-caption"
          style={{ gap: 8, color: "var(--ts-bad)" }}
        >
          <span>{t(failure.key)}</span>
          {isTransientSaveError(failure.key) ? (
            <button type="button" className={button} onClick={() => void run(failure.action)}>
              {t("common:buttons.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Where a booking's total lives and how it enters every total (forgejo#219),
 * stated as the counting rule the server applies — `utils/stats/dedupedCost.ts`
 * `flightCostShare`, the contract forgejo#274 writes down: a booking price
 * counts ONCE for the whole booking and is all-in; without one, each flight
 * counts its own price plus taxes and fees; 0 is free, an empty field is
 * unknown. This explains that rule; it does not make a second one.
 *
 * The optional split (flights-only bookings with a total and two or more
 * flights) is display-only and stored on the booking, so no total ever adds
 * it to the booking price.
 */
export default function BookingPrice({
  flight,
  answer,
  onAnswer,
}: {
  flight: Flight;
  answer: FlightBookingAnswer;
  onAnswer: (answer: FlightBookingAnswer) => void;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["flights"]);
  const booking = answer.booking;
  if (!booking) return null;
  const priced = isAmountRecorded(booking.price);
  const splittable = priced && booking.otherEntries === 0 && answer.segments.length >= 2;
  return (
    <div className="flex flex-col t-caption" style={{ gap: 6 }} data-testid="booking-price">
      {priced ? (
        <>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}>
            {t("flights:bookingPrice.total", {
              amount: formatAmount(booking.price!, booking.currency, { language: i18n.language }),
            })}
          </p>
          <p>{t("flights:bookingPrice.storedOnBooking")}</p>
          <p>{t("flights:bookingPrice.countedOnce")}</p>
          {booking.price === 0 ? <p>{t("flights:bookingPrice.zeroIsFree")}</p> : null}
        </>
      ) : (
        <p>{t("flights:bookingPrice.noTotal")}</p>
      )}
      {booking.otherEntries > 0 ? (
        <p>{t("flights:bookingPrice.otherEntries", { count: booking.otherEntries })}</p>
      ) : null}
      {/* The booking's own trip, where its price is edited — not the
          flight's: segments can move to another trip while the booking
          stays (review I4). */}
      {booking.tripId ? (
        <Link
          to={`/trips/${booking.tripId}`}
          className={`inline-flex items-center underline underline-offset-4 ${DAY_CARD_TOUCH}`}
          style={{ color: "var(--ts-accent)", fontWeight: 600 }}
        >
          {booking.tripName
            ? t("flights:bookingPrice.editOnNamedTrip", { name: booking.tripName })
            : t("flights:bookingPrice.editOnTrip")}
        </Link>
      ) : (
        <p>{t("flights:bookingPrice.noTrip")}</p>
      )}
      {splittable ? <SplitControls flight={flight} answer={answer} onAnswer={onAnswer} /> : null}
    </div>
  );
}
