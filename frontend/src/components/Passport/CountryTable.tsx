import { useState } from "react";
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
type CountryView = "ground" | "visited" | "unclear";

/**
 * The three lists of forgejo#299: every country with ground presence, the
 * visited subset, and the ground countries whose visit the records cannot
 * decide — shown on their own so an open-jaw end is found, not lost.
 */
const VIEW_FILTER: Record<CountryView, (c: PassportCountry) => boolean> = {
  ground: () => true,
  visited: (c) => c.visited ?? c.counted,
  unclear: (c) => c.visitUncertain === true,
};

const VIEW_LABEL: Record<CountryView, string> = {
  ground: "passport:summary.groundCountries",
  visited: "passport:summary.countries",
  unclear: "passport:summary.unclearCountries",
};

export default function CountryTable({
  countries,
  locale,
}: {
  countries: PassportCountry[];
  locale: string;
}): JSX.Element {
  const { t } = useTranslation(["passport"]);
  const [view, setView] = useState<CountryView>("ground");
  const visible = countries.filter(VIEW_FILTER[view]);

  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
      aria-labelledby="countries-heading"
    >
      <h2 id="countries-heading" className="text-sm font-semibold px-4 pt-4 pb-1 sm:px-6 sm:pt-6">
        {t("passport:countries.title")}
      </h2>
      <div
        className="flex gap-3 px-4 py-3 sm:px-6"
        role="group"
        aria-label={t("passport:countries.title")}
      >
        {(Object.keys(VIEW_LABEL) as CountryView[]).map((kind) => (
          <button
            type="button"
            key={kind}
            aria-pressed={view === kind}
            onClick={() => setView(kind)}
            className="rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            {t(VIEW_LABEL[kind])}
          </button>
        ))}
      </div>
      <p className="text-xs px-4 pb-3 sm:px-6" style={{ color: "var(--text-muted)" }}>
        {t("passport:countries.listNote")}
      </p>
      <div className="overflow-x-auto">
        <table className="ts-passport-table w-full text-sm">
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
            {visible.map((row) => (
              <CountryRow key={row.code} row={row} countryLabel={countryName(row.code, locale)} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs px-4 pt-3 sm:px-6" style={{ color: "var(--text-muted)" }}>
        {t("passport:countries.dashLegend")}
      </p>
      <p className="text-xs px-4 pb-3 pt-1 sm:px-6" style={{ color: "var(--text-muted)" }}>
        {t("passport:countries.groundTimeLegend")}
      </p>
    </section>
  );
}
