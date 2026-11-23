import { useState } from "react";
import OverflowMenu from "../ui/OverflowMenu";
import { useChangeHistoryMenu } from "../changeHistory/useChangeHistoryMenu";
import DocumentsSection from "../documents/DocumentsSection";
import EntryPhotos from "../common/EntryPhotos";
import ProvenanceDialog from "../provenance/ProvenanceDialog";
import ProvenanceLine from "../provenance/ProvenanceLine";
import PurposeChip from "../../components/purpose/PurposeChip";
import { PackageBookingCard } from "../bookings/PackageBookingCard";
import { usePackageSplit } from "../bookings/usePackageSplit";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useRatingCategories } from "../../hooks/useRatingCategories";
import { storedRatingsOf } from "../../shared/ratingDerivation";
import { useSettingsStore } from "../../store/settingsStore";
import { formatRatingText, formatStayPriceDisplay } from "../../lib/lodgingFormat";
import { formatStayPeriod, hasUnknownLength, stayNights } from "../../lib/lodgingDateDisplay";
import type { StayMembershipSource } from "../../shared/membershipDerivation";
import type { LodgingStay } from "../../types/lodging";
import { StayStatusPill } from "./StayStatusPill";
import { StayNightPriceLine } from "./StayNightPriceLine";
import Toggletip from "../ui/Toggletip";
import { deadlineFacts } from "../../lib/deadlines";
import { dateLocaleForLanguage } from "../../lib/units";

interface LodgingStayCardProps {
  stay: LodgingStay;
  onEdit?: (stay: LodgingStay) => void;
  /**
   * Asks the CALLER to start the deletion — it owns the confirmation, so a
   * stay is never removed by the click that mentions it. Omitted where the
   * card is read-only.
   */
  onDelete?: (stay: LodgingStay) => void;
  /** A restore from the stay's history wrote a value: the page reloads. */
  onHistoryRestored?: () => void;
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
  /**
   * Re-read the stay after its origin was saved. The origin ("aus der Erinnerung") is edited from
   * this card's ⋯; leave it out where the card is read-only.
   */
  onProvenanceSaved?: () => void;
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
  onDelete,
  onHistoryRestored,
  tripName,
  membershipName,
  membershipSource,
  onProvenanceSaved,
}: LodgingStayCardProps): JSX.Element {
  const { t, i18n } = useTranslation(["lodging", "common", "provenance"]);
  const [editingOrigin, setEditingOrigin] = useState(false);
  const packageSplit = usePackageSplit();
  const changeHistory = useChangeHistoryMenu({
    entityType: "lodgingStay",
    entityId: stay.id,
    onRestored: onHistoryRestored,
  });
  const { labelOf } = useRatingCategories();
  const baseCurrency = useSettingsStore((st) => st.baseCurrency);
  const nights = stayNights(stay);
  const deadlineLocale = dateLocaleForLanguage(i18n.language);
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
    },
    baseCurrency
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
        <span className="text-sm font-semibold text-[var(--text-primary)]">{period.label}</span>
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
        <PurposeChip entry={stay} />
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
        {/* Edit and delete are one card ⋯ (owner, 2026-11-22). The red belongs to
            the confirmation, which is where the consequence is actually stated. */}
        {(onEdit || onDelete || onProvenanceSaved || onHistoryRestored || packageSplit.entry) && (
          <OverflowMenu
            label={t("lodging:stay.menuLabel")}
            testId={`stay-menu-${stay.id}`}
            entries={[
              ...(onEdit
                ? [
                    {
                      key: "edit",
                      testId: `stay-edit-${stay.id}`,
                      label: t("common:buttons.edit"),
                      onSelect: () => onEdit(stay),
                    },
                  ]
                : []),
              ...(onProvenanceSaved
                ? [
                    {
                      key: "provenance",
                      testId: `stay-provenance-${stay.id}`,
                      label: t("provenance:editor.menu"),
                      onSelect: () => setEditingOrigin(true),
                    },
                  ]
                : []),
              ...(packageSplit.entry ? [packageSplit.entry] : []),
              ...(onHistoryRestored ? [changeHistory.entry] : []),
              ...(onDelete
                ? [
                    {
                      key: "delete",
                      testId: `stay-delete-${stay.id}`,
                      label: t("common:buttons.delete"),
                      danger: true,
                      onSelect: () => onDelete(stay),
                    },
                  ]
                : []),
            ]}
          >
            {onHistoryRestored && changeHistory.node}
            {editingOrigin && (
              <ProvenanceDialog
                entryType="lodgingStay"
                entry={stay}
                onClose={() => setEditingOrigin(false)}
                onSaved={() => onProvenanceSaved?.()}
              />
            )}
          </OverflowMenu>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
        {stay.board && (
          <span>
            {t("lodging:field.board")}:{" "}
            <b className="text-[var(--text-primary)]">{t(`lodging:board.${stay.board}`)}</b>
          </span>
        )}
        {Object.entries(storedRatingsOf(stay)).map(([key, value]) => (
          <span key={key} data-testid={`stay-rating-${stay.id}-${key}`}>
            {labelOf(key)}: <b className="text-[var(--text-primary)]">{formatRatingText(value)}</b>
          </span>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          data-testid={`stay-price-${stay.id}`}
          className="font-semibold text-[var(--text-primary)]"
        >
          {original}
        </span>
        {fxReadout !== null && (
          <Toggletip
            data-testid={`stay-fx-readout-${stay.id}`}
            triggerClassName="text-[var(--fx,#6ab7d8)]"
            content={readoutTitle}
          >
            {fxReadout}
          </Toggletip>
        )}
        {marker !== null && (
          <Toggletip
            data-testid={`stay-fx-marker-${stay.id}`}
            triggerClassName="rounded border border-[var(--border)] px-1 py-px text-[10px] text-[var(--text-muted)]"
            content={
              stay.fxSource === "manual"
                ? t("lodging:fx.tooltipManual", { rate: stay.fxRate ?? "" })
                : t("lodging:fx.tooltipNone")
            }
          >
            {marker}
          </Toggletip>
        )}
      </div>

      <StayNightPriceLine stay={stay} nights={hasUnknownLength(stay) ? null : nights} />

      {stay.bookingReference && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {t("lodging:field.bookingReference")}: {stay.bookingReference}
        </p>
      )}
      {deadlineFacts(stay.times, t, deadlineLocale)
        .filter((fact) => fact.value !== null)
        .map((fact) => (
          <p key={fact.label} className="mt-2 text-xs text-[var(--text-muted)]">
            {fact.label}: {fact.value}
          </p>
        ))}
      {stay.bookingId && (
        <div className="mt-2">
          <PackageBookingCard
            bookingId={stay.bookingId}
            highlight={{ kind: "stay", id: stay.id }}
            controller={packageSplit.controller}
          />
        </div>
      )}
      {stay.notes && (
        <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--text-muted)]">{stay.notes}</p>
      )}
      <ProvenanceLine entry={stay} className="t-caption mt-2" />
      {/* Photos and documents hang off the STAY, never the house (owner, 2026-11-22): each stay
          shows its own. */}
      <div className="mt-3">
        <EntryPhotos kind="stay" entryId={stay.id} />
      </div>
      {/* Documents hang off the STAY, never the house (owner, 2026-11-22): the list and the
          upload both live on the card of the stay they belong to. */}
      <DocumentsSection layout="inline" entry={{ type: "lodgingStay", id: stay.id }} />
    </div>
  );
}
