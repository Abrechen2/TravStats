import { useState } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { passportOverridesApi } from "../../lib/api/passportOverrides";
import { formatDate } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import type { ExcludedCountry } from "../../types/passport";
import { countryName } from "./countryName";
import { overrideErrorKey } from "./overrideErrors";

/**
 * Countries the user took out of the passport (forgejo#308). They are in no
 * figure, so this is the one place they are still seen — with the note that
 * says why, and the way back.
 */
export default function ExcludedCountries({
  countries,
  locale,
  onChanged,
}: {
  countries: ExcludedCountry[];
  locale: string;
  onChanged: () => Promise<void>;
}): JSX.Element | null {
  const { t } = useTranslation(["passport"]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (countries.length === 0) return null;

  const restore = async (code: string): Promise<void> => {
    setBusy(code);
    setError(null);
    try {
      await passportOverridesApi.remove(code);
    } catch (err) {
      logger.error("Failed to restore an excluded country:", err);
      setError(t(overrideErrorKey(err, "passport:overrides.restoreError")));
      setBusy(null);
      return;
    }
    try {
      await onChanged();
    } catch (err) {
      logger.error("Failed to reload passport after restoring a country:", err);
      setError(t("passport:overrides.reloadError"));
    }
    setBusy(null);
  };

  return (
    <section
      aria-labelledby="excluded-countries-heading"
      className="mt-6 rounded-xl border p-4 sm:p-6"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
    >
      <h2 id="excluded-countries-heading" className="text-sm font-semibold mb-2">
        {t("passport:overrides.excludedTitle")}
      </h2>
      <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
        {t("passport:overrides.excludedExplanation")}
      </p>
      <ul className="space-y-3">
        {countries.map((country) => (
          <li key={country.code} className="flex flex-wrap items-start justify-between gap-2">
            <div className="text-sm">
              <span className="font-mono text-xs mr-2 opacity-70">{country.code}</span>
              <span className="font-medium">{countryName(country.code, locale)}</span>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("passport:overrides.provenanceNote", { note: country.note })}
                {country.day &&
                  ` · ${t("passport:overrides.provenanceDay", { day: formatDate(country.day) })}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void restore(country.code)}
              disabled={busy !== null}
              className="text-sm px-3 py-1.5 rounded-lg border print:hidden"
              style={{ borderColor: "var(--border)" }}
            >
              {t("passport:overrides.restore")}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm mt-3" style={{ color: "var(--ts-bad)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
