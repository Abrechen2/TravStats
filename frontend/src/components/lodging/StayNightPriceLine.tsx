import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { stayNightPrice } from "../../lib/lodging/stayNightPrice";
import { formatCurrency } from "../../lib/units";
import type { LodgingStay } from "../../types/lodging";

/**
 * A stay's two per-night figures, each named for what it is (forgejo#178):
 * "Zimmer pro Nacht" is the stored room rate; "Ø pro Nacht gesamt" is the
 * total divided by the nights, with the calculation and what the total holds
 * beyond the room rate. Renders nothing when neither can be stated.
 */
export function StayNightPriceLine({
  stay,
  nights,
}: {
  stay: Pick<LodgingStay, "id" | "totalPrice" | "pricePerNight" | "currency">;
  /** Null when the length of the stay is not known. */
  nights: number | null;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["lodging"]);
  const price = stayNightPrice({
    totalPrice: stay.totalPrice,
    pricePerNight: stay.pricePerNight,
    nights,
  });
  if (price.roomRate === null && price.average === null) return null;
  const money = (n: number) => formatCurrency(n, stay.currency, { language: i18n.language });

  return (
    <div
      data-testid={`stay-night-price-${stay.id}`}
      className="mt-2 flex flex-col gap-0.5 text-xs text-[var(--text-muted)]"
    >
      {price.roomRate !== null && (
        <span>
          {t("lodging:nightPrice.roomRate")}:{" "}
          <b className="text-[var(--text-primary)]">{money(price.roomRate)}</b>
        </span>
      )}
      {price.average !== null && (
        <span>
          {t("lodging:nightPrice.average")}:{" "}
          <b className="text-[var(--text-primary)]">{money(price.average.perNight)}</b>{" "}
          {t("lodging:nightPrice.calculation", {
            total: money(price.average.total),
            count: price.average.nights,
            result: money(price.average.perNight),
          })}
          {price.extras !== null &&
            ` · ${t("lodging:nightPrice.extras", { amount: money(price.extras) })}`}
        </span>
      )}
      {price.average !== null && <span>{t("lodging:nightPrice.scope")}</span>}
    </div>
  );
}
