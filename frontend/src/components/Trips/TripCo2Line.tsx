import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { dateLocaleForLanguage } from "../../lib/units";
import type { Co2Stats } from "../../types/co2";

/**
 * A trip's carbon, every mode listed beside the sum (forgejo#395): the total is
 * only ever shown with its parts, because the parts rest on different bases
 * (per passenger-km, per vehicle-km, a cruise lower bound). Records without a
 * known distance are counted out loud instead of being read as zero.
 */
export default function TripCo2Line({ co2 }: { co2: Co2Stats | undefined }): JSX.Element | null {
  const { t, i18n } = useTranslation(["common"]);
  if (!co2 || co2.totalKg === null) return null;
  const locale = dateLocaleForLanguage(i18n.language);
  const kg = (n: number): string => `${Math.round(n).toLocaleString(locale)} kg`;
  const parts = [
    ...(co2.flights.kg === null ? [] : [{ key: "flight", kg: co2.flights.kg, lowerBound: false }]),
    ...co2.modes.flatMap((m) =>
      m.kg === null ? [] : [{ key: m.mode, kg: m.kg, lowerBound: m.lowerBound }]
    ),
  ];
  // A lower-bound part (the cruise proxy) makes the sum a lower bound too.
  const sign = (lowerBound: boolean): string => (lowerBound ? "≥" : "≈");
  const unmeasured =
    co2.modes.reduce((n, m) => n + (m.records - m.measured), 0) +
    (co2.flights.records - co2.flights.measured);
  return (
    <p className="text-sm" style={{ color: "var(--text-muted)" }} data-testid="trip-co2">
      <span style={{ color: "var(--text-primary)" }}>
        {t("common:co2.tripTotal", {
          total: `${sign(parts.some((p) => p.lowerBound))} ${kg(co2.totalKg)}`,
        })}
      </span>
      {" · "}
      {parts
        .map((p) => `${t(`common:co2.modes.${p.key}`)} ${sign(p.lowerBound)} ${kg(p.kg)}`)
        .join(" · ")}
      {unmeasured > 0 && ` · ${t("common:co2.unmeasured", { count: unmeasured })}`}
    </p>
  );
}
