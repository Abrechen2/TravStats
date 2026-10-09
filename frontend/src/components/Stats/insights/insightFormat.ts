import { useMemo } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import { formatDuration } from "../../../lib/formatters";
import { localeForLanguage } from "../../../lib/units";

export interface InsightFormat {
  num: (n: number) => string;
  /** A 0–1 share as a whole percentage. */
  pct: (share: number) => string;
  /** A local calendar day `YYYY-MM-DD` — a date, never an instant, so read in UTC. */
  day: (day: string) => string;
  duration: (minutes: number) => string;
}

/** The reader's language and date format, applied once for every insight block. */
export function useInsightFormat(): InsightFormat {
  const { i18n } = useTranslation(["stats"]);
  const display = useDisplayFormat();
  const locale = localeForLanguage(i18n.language);
  return useMemo(
    () => ({
      num: (n) => n.toLocaleString(locale),
      pct: (share) => `${Math.round(share * 100).toLocaleString(locale)} %`,
      day: (day) => display.date(`${day}T00:00:00Z`, { timeZone: "UTC" }),
      duration: formatDuration,
    }),
    [locale, display]
  );
}

/** Code → "CODE · Name" where the loaded flights name it, else the code. */
export function airportNamer(names: ReadonlyMap<string, string>): (code: string) => string {
  return (code) => {
    const name = names.get(code.toUpperCase());
    return name ? `${code} · ${name}` : code;
  };
}
