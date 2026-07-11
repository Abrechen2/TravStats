import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatDateInTimezone } from "../../lib/dateUtils";
import { formatStayPriceDisplay, nightsBetween } from "../../lib/lodgingFormat";
import type { LodgingStay } from "../../types/lodging";

interface LodgingStayCardProps {
  stay: LodgingStay;
}

/** "★ 4.0" for a rating value, "—" when unrated. Half-steps render as-is (e.g. 4.5). */
function ratingText(value: number | null): string {
  return value !== null ? `★ ${value}` : "—";
}

/**
 * One stay card on the lodging detail page: dates/nights/room, per-category
 * ratings, and the price + FX readout. The FX readout is the distinctive
 * part — a stay is billed in the hotel's own currency, and the backend
 * snapshots the ECB-rate conversion into the user's base currency at
 * check-in time. That snapshot's four fields are null TOGETHER whenever the
 * rate lookup failed at save time (the stay itself always still saves), so
 * this card must render the plain original price alone in that case —
 * never a partial/`null`/`NaN` conversion line (see `formatStayPriceDisplay`).
 */
export function LodgingStayCard({ stay }: LodgingStayCardProps): JSX.Element {
  const { t, i18n } = useTranslation(["lodging", "common"]);
  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  const { original, fxReadout } = formatStayPriceDisplay(
    {
      totalPrice: stay.totalPrice,
      currency: stay.currency,
      totalPriceBase: stay.totalPriceBase,
      fxRate: stay.fxRate,
      fxRateDate: stay.fxRateDate,
      fxBaseCurrency: stay.fxBaseCurrency,
    },
    i18n.language,
    t("lodging:fx.source")
  );

  return (
    <div
      className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-3"
      data-testid={`stay-card-${stay.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {formatDateInTimezone(stay.checkIn, "UTC")} – {formatDateInTimezone(stay.checkOut, "UTC")}
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {t("lodging:field.nightsCount", { count: nights })}
          {stay.roomCategory ? ` · ${stay.roomCategory}` : ""}
          {stay.roomNumber ? ` · ${t("lodging:field.room")} ${stay.roomNumber}` : ""}
        </span>
        {stay.isAwardStay && (
          <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
            {t("lodging:field.awardStay")}
          </span>
        )}
        <span className="ml-auto text-sm font-semibold" style={{ color: "var(--star)" }}>
          {ratingText(stay.ratingOverall)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
        {stay.board && (
          <span>
            {t("lodging:field.board")}:{" "}
            <b className="text-[var(--text-primary)]">{t(`lodging:board.${stay.board}`)}</b>
          </span>
        )}
        <span>
          {t("lodging:field.ratingBreakfast")}:{" "}
          <b className="text-[var(--text-primary)]">{ratingText(stay.ratingBreakfast)}</b>
        </span>
        <span>
          {t("lodging:field.ratingService")}:{" "}
          <b className="text-[var(--text-primary)]">{ratingText(stay.ratingService)}</b>
        </span>
        <span>
          {t("lodging:field.ratingRoom")}:{" "}
          <b className="text-[var(--text-primary)]">{ratingText(stay.ratingRoom)}</b>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span data-testid={`stay-price-${stay.id}`} className="font-semibold text-[var(--text-primary)]">
          {original}
        </span>
        {fxReadout !== null && (
          <span
            data-testid={`stay-fx-readout-${stay.id}`}
            className="text-[var(--fx,#6ab7d8)]"
            title={t("lodging:fx.tooltip")}
          >
            {fxReadout}
          </span>
        )}
      </div>

      {stay.bookingReference && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {t("lodging:field.bookingReference")}: {stay.bookingReference}
        </p>
      )}
      {stay.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--text-muted)]">{stay.notes}</p>}
    </div>
  );
}
