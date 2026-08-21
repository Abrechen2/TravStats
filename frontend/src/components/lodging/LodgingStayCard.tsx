import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatRatingText, formatStayPriceDisplay } from "../../lib/lodgingFormat";
import {
  formatStayPeriod,
  hasUnknownLength,
  stayNights,
} from "../../lib/lodgingDateDisplay";
import type { StayMembershipSource } from "../../shared/membershipDerivation";
import type { LodgingStay } from "../../types/lodging";
import { StayStatusPill } from "./StayStatusPill";

interface LodgingStayCardProps {
  stay: LodgingStay;
  onEdit?: (stay: LodgingStay) => void;
  /** Resolved from `stay.tripId` by the caller (a stay only stores the id).
   * Undefined when unresolved/not linked — the pill is skipped either way. */
  tripName?: string;
  /**
   * The programme name resolved by the caller via `deriveStayMembership` —
   * NOT read from `stay.membershipId` directly. That column is an override
   * only; the migration nulled it for every stay whose stored card already
   * matched what derivation now produces, so a raw read would make the chip
   * vanish for the normal case. Undefined (no chip) when derivation resolves
   * to "none".
   */
  membershipName?: string;
  /** How `membershipName` was resolved — shown as a small qualifier next to the chip. */
  membershipSource?: StayMembershipSource;
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
export function LodgingStayCard({
  stay,
  onEdit,
  tripName,
  membershipName,
  membershipSource,
}: LodgingStayCardProps): JSX.Element {
  const { t, i18n } = useTranslation(["lodging", "common"]);
  const nights = stayNights(stay);
  const period = formatStayPeriod(stay, i18n.language, t);
  const { original, fxReadout, marker } = formatStayPriceDisplay(
    {
      totalPrice: stay.totalPrice,
      currency: stay.currency,
      totalPriceBase: stay.totalPriceBase,
      fxRate: stay.fxRate,
      fxRateDate: stay.fxRateDate,
      fxBaseCurrency: stay.fxBaseCurrency,
      // Without this the formatter cannot tell an ECB rate from a CDN or a
      // hand-typed one, and silently labelled all three "EZB" (found in
      // browser acceptance — every unit test stayed green, because they call
      // the formatter directly and DO pass it).
      fxSource: stay.fxSource,
    },
    i18n.language,
    {
      ecb: t("lodging:fx.source"),

      market: t("lodging:fx.sourceMarket"),

      manual: t("lodging:fx.markerManual"),

      none: t("lodging:fx.markerNone"),
    }
  );

  // The hover text names the same source the readout does — one derivation, so
  // the two can never disagree about where the rate came from.
  const readoutTitle =
    stay.fxSource === "manual"
      ? t("lodging:fx.tooltipManual", { rate: stay.fxRate ?? "" })
      : stay.fxSource === "cdn"
        ? t("lodging:fx.tooltipMarket")
        : t("lodging:fx.tooltip");

  return (
    <div
      className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-3"
      data-testid={`stay-card-${stay.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {period.label}
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {/* A stay nobody knows the length of shows that, rather than "0 nights" —
              which reads as a same-day stay somebody actually recorded. */}
          {hasUnknownLength(stay)
            ? t("lodging:period.unknownLength")
            : t("lodging:field.nightsCount", { count: nights })}
          {stay.roomCategory ? ` · ${stay.roomCategory}` : ""}
          {stay.roomNumber ? ` · ${t("lodging:field.room")} ${stay.roomNumber}` : ""}
        </span>
        {/* Owner ask (2026-08-20): the status must be visible in lists, like
            the flights table — a cancelled stay used to look identical to a
            booked one here. */}
        <StayStatusPill status={stay.status} testId={`stay-status-${stay.id}`} />
        {stay.isAwardStay && (
          <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
            {t("lodging:field.awardStay")}
          </span>
        )}
        {stay.tripId && tripName && (
          <span
            data-testid={`stay-trip-pill-${stay.id}`}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ background: "rgba(240,169,71,0.13)", color: "var(--accent)" }}
          >
            🧳 {t("lodging:field.trip")}: {tripName}
          </span>
        )}
        {membershipName !== undefined && (
          <span
            data-testid={`stay-membership-chip-${stay.id}`}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--bg-surface-2,transparent)] px-2 py-0.5 text-xs text-[var(--text-muted)]"
          >
            🎖️ {membershipName}
            {membershipSource && membershipSource !== "none" && (
              <span className="text-[var(--text-faint,#5c6878)]">
                ({t(`lodging:field.membershipSource.${membershipSource}`)})
              </span>
            )}
          </span>
        )}
        <span className="ml-auto text-sm font-semibold" style={{ color: "var(--star)" }}>
          {formatRatingText(stay.ratingOverall)}
        </span>
        {onEdit && (
          <button
            type="button"
            data-testid={`stay-edit-${stay.id}`}
            onClick={() => onEdit(stay)}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            {t("common:buttons.edit")}
          </button>
        )}
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
          <b className="text-[var(--text-primary)]">{formatRatingText(stay.ratingBreakfast)}</b>
        </span>
        <span>
          {t("lodging:field.ratingService")}:{" "}
          <b className="text-[var(--text-primary)]">{formatRatingText(stay.ratingService)}</b>
        </span>
        <span>
          {t("lodging:field.ratingRoom")}:{" "}
          <b className="text-[var(--text-primary)]">{formatRatingText(stay.ratingRoom)}</b>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          data-testid={`stay-price-${stay.id}`}
          className="font-semibold text-[var(--text-primary)]"
        >
          {original}
        </span>
        {fxReadout !== null && (
          <span
            data-testid={`stay-fx-readout-${stay.id}`}
            className="text-[var(--fx,#6ab7d8)]"
            title={readoutTitle}
          >
            {fxReadout}
          </span>
        )}
        {marker !== null && (
          <span
            data-testid={`stay-fx-marker-${stay.id}`}
            className="rounded border border-[var(--border)] px-1 py-px text-[10px] text-[var(--text-muted)]"
            title={
              stay.fxSource === "manual"
                ? t("lodging:fx.tooltipManual", { rate: stay.fxRate ?? "" })
                : t("lodging:fx.tooltipNone")
            }
          >
            {marker}
          </span>
        )}
      </div>

      {stay.bookingReference && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {t("lodging:field.bookingReference")}: {stay.bookingReference}
        </p>
      )}
      {stay.notes && (
        <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--text-muted)]">{stay.notes}</p>
      )}
    </div>
  );
}
