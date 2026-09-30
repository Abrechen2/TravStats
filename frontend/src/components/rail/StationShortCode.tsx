import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

interface Props {
  code: string | null | undefined;
}

/**
 * The DB station code (Ril 100 — "KK" for Köln Hbf) beside a station name, as
 * a small monospaced tag. Nothing at all when the code is unknown: the server
 * answers null rather than guessing, and so does this.
 */
export function StationShortCode({ code }: Props): JSX.Element | null {
  const { t } = useTranslation(["rail"]);
  if (!code) return null;
  return (
    <abbr
      className="ml-1.5 inline-block rounded border px-1 align-middle text-xs no-underline"
      style={{
        fontFamily: "var(--ts-font-mono)",
        borderColor: "var(--ts-border)",
        color: "var(--ts-muted)",
      }}
      title={t("rail:station.shortCodeTitle", { code })}
      data-testid="station-short-code"
    >
      {code}
    </abbr>
  );
}
