import { useTranslation } from "../../hooks/useTranslation";
import type { PassportCountry } from "../../types/passport";
import CountryRow from "./CountryRow";
import { countryName } from "./countryName";

/**
 * Every country with any evidence at all — including the ones the headline does
 * not count.
 *
 * The list is deliberately NOT filtered by the threshold. Only the headline
 * applies one; the list is where a reader can see a country classed as a
 * connection, disagree, and open the records that produced the classification.
 * A filter would remove the row and with it the only chance to notice.
 *
 * The legend under the table names what a dash means. Without it a reader has
 * to guess whether "—" is zero, unknown, or a rendering failure, and that guess
 * is exactly the ambiguity the abstention rule exists to remove.
 *
 * Two columns stand beside the tier and never decide it (spec §3.4b): the days
 * a record places the traveller here, and the longest measured spell on the
 * ground. A duration is shown as evidence, never used as a threshold — the tier
 * still comes from structure, and the second legend line says which of the two
 * blanks a reader can do something about.
 */
export default function CountryTable({
  countries,
  locale,
}: {
  countries: PassportCountry[];
  locale: string;
}): JSX.Element {
  const { t } = useTranslation(["passport"]);

  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
      aria-labelledby="countries-heading"
    >
      <h2 id="countries-heading" className="text-sm font-semibold px-6 pt-6 pb-1">
        {t("passport:countries.title")}
      </h2>
      <p className="text-xs px-6 pb-3" style={{ color: "var(--text-muted)" }}>
        {t("passport:countries.listNote")}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr
              className="text-left text-[11px] uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              <th className="px-6 py-2 font-medium">{t("passport:countries.country")}</th>
              <th className="px-3 py-2 font-medium">{t("passport:countries.evidence")}</th>
              <th className="px-3 py-2 font-medium text-right">
                {t("passport:countries.entries")}
              </th>
              {/* Days travel further than hours: a day exists for a house, a
                  port call and a flight pair alike, an hour only for a flight
                  pair (spec §3.4b). Hence the days column comes first. */}
              <th className="px-3 py-2 font-medium text-right">
                {t("passport:countries.daysPresent")}
              </th>
              <th className="px-3 py-2 font-medium text-right">
                {t("passport:countries.groundTime")}
              </th>
              <th className="px-3 py-2 font-medium">{t("passport:countries.period")}</th>
              <th className="px-6 py-2 font-medium">{t("passport:countries.airports")}</th>
            </tr>
          </thead>
          <tbody>
            {countries.map((row) => (
              <CountryRow key={row.code} row={row} countryLabel={countryName(row.code, locale)} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs px-6 pt-3" style={{ color: "var(--text-muted)" }}>
        {t("passport:countries.dashLegend")}
      </p>
      <p className="text-xs px-6 pb-3 pt-1" style={{ color: "var(--text-muted)" }}>
        {t("passport:countries.groundTimeLegend")}
      </p>
    </section>
  );
}
