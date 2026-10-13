import { useTranslation } from "../../hooks/useTranslation";
import type { Passport } from "../../types/passport";
import { countryName } from "./countryName";

/** Raw observations stay visible without being presented as visits. */
export default function UnconfirmedCountries({
  countries,
  locale,
}: {
  countries: NonNullable<Passport["unconfirmedCountries"]>;
  locale: string;
}): JSX.Element | null {
  const { t } = useTranslation(["passport"]);
  if (countries.length === 0) return null;
  const date = (day: string): string =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  return (
    <section
      aria-labelledby="unconfirmed-countries-heading"
      className="mt-6 rounded-xl border p-4 sm:p-6"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
        color: "var(--text-primary)",
      }}
    >
      <h2 id="unconfirmed-countries-heading" className="text-sm font-semibold mb-2">
        {t("passport:unconfirmed.title")}
      </h2>
      <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
        {t("passport:unconfirmed.explanation")}
      </p>
      <ul className="space-y-3">
        {countries.map((country) => (
          <li key={country.code} className="text-sm">
            <span className="font-medium">{countryName(country.code, locale)}</span>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("passport:unconfirmed.observation", {
                days: country.observedDays,
                points: country.pointCount,
              })}
              {" · "}
              <time dateTime={country.firstDate}>{date(country.firstDate)}</time>
              {country.lastDate !== country.firstDate && (
                <>
                  {" – "}
                  <time dateTime={country.lastDate}>{date(country.lastDate)}</time>
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
