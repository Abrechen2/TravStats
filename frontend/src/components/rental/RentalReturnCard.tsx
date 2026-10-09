import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatStationMoment } from "../../lib/rentalTime";
import { depositSummary } from "../../lib/rental/rentalDeposit";
import { rentalReturnFacts } from "../../lib/rental/rentalReturnCard";
import { formatAmount } from "../../lib/units";
import { formatDayLong } from "../../shared/time";
import type { RentalBooking } from "../../types/rental";

interface Props {
  rental: RentalBooking;
  /** Opens the form at its return step. */
  onRecordReturn: () => void;
}

const ACTION_CLASS =
  "inline-flex items-center rounded-md border border-border px-3 py-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)";

/**
 * The return at a glance (forgejo#240): where the car goes back, when on that
 * station's clock, the fuel rule, the reader's own notes — and a directions
 * link to the RETURN station, which on a one-way rental is not where the car
 * was picked up. Every missing fact is said as missing; none is filled from
 * the pickup station.
 */
export function RentalReturnCard({ rental, onRecordReturn }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["rental"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const facts = rentalReturnFacts(rental);
  const when = rental.times.return;
  const deposit = depositSummary(
    t,
    rental,
    (amount, currency) => formatAmount(amount, currency, { language: i18n.language }),
    (day) => formatDayLong(day, locale, { day: "numeric", month: "short", year: "numeric" })
  );

  const row = (testId: string, label: string, value: string, missing = false): JSX.Element => (
    <div className="flex flex-wrap gap-x-2" data-testid={testId}>
      <dt className="t-caption">{label}</dt>
      <dd className={missing ? "text-(--text-muted) italic" : ""}>{value}</dd>
    </div>
  );

  return (
    <section
      aria-labelledby="rental-return-card-title"
      className="rounded-lg border border-border p-4"
      data-testid="rental-return-card"
    >
      <h2 id="rental-return-card-title" className="mb-2 text-base font-medium">
        {t("rental:returnCard.title")}
        {facts.oneWay ? (
          <span className="t-caption ml-2">{t("rental:returnCard.oneWay")}</span>
        ) : null}
      </h2>
      <dl className="space-y-1 text-sm">
        {row(
          "rental-return-station",
          t("rental:returnCard.station"),
          [facts.station, facts.iata ? `(${facts.iata})` : null, facts.address]
            .filter(Boolean)
            .join(" ")
        )}
        {row(
          "rental-return-when",
          t("rental:returnCard.when"),
          when
            ? `${formatStationMoment(when, locale)}${when.zone ? ` · ${t("rental:returnCard.localTime", { zone: when.zone })}` : ""}`
            : t("rental:returnCard.whenMissing"),
          !when
        )}
        {row(
          "rental-return-fuel",
          t("rental:returnCard.fuel"),
          facts.fuelPolicy
            ? t(`rental:fuel.${facts.fuelPolicy}`)
            : t("rental:returnCard.fuelMissing"),
          !facts.fuelPolicy
        )}
        {row(
          "rental-return-notes",
          t("rental:returnCard.notes"),
          facts.notes ?? t("rental:returnCard.notesMissing"),
          facts.notes === null
        )}
        {deposit ? row("rental-return-deposit", t("rental:deposit.title"), deposit) : null}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {facts.navigationUrl ? (
          <a
            href={facts.navigationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={ACTION_CLASS}
            data-testid="rental-return-navigate"
          >
            {t("rental:returnCard.navigate", { station: facts.station })}
          </a>
        ) : (
          <p role="status" className="t-caption" data-testid="rental-return-no-position">
            {t("rental:returnCard.noPosition")}
          </p>
        )}
        <button type="button" onClick={onRecordReturn} className={ACTION_CLASS}>
          {t("rental:returnCard.record")}
        </button>
      </div>
    </section>
  );
}
