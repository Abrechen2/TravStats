import type { Flight } from "../types";

export type SourceInfoLine = { icon: string; label: string; detail?: string };
type TFunction = (key: string, options?: Record<string, unknown>) => string;

const SOURCE_ICONS: Record<string, string> = {
  email_import: "📧",
  boarding_pass_scan: "🎫",
  historical_enrichment: "🔍",
  live_update: "🔄",
  api_lookup: "🌐",
  imported_fr24: "📊",
  imported_generic_csv: "📥",
  imported_roundtrip: "↻",
};

/**
 * Data-provenance lines for the row's ℹ tooltip. Empty array = nothing worth
 * telling (a plain manual flight) — the ℹ is not rendered then. Mirrors the
 * retired DataSourceBadges semantics, minus the "Manuell" badge, which is
 * the default state rather than information.
 */
export function getFlightSourceInfo(flight: Flight, t: TFunction): SourceInfoLine[] {
  const lines: SourceInfoLine[] = [];
  const combined = flight.dataSource === "live_update" && flight.lastModifiedBy === "auto_update";
  const history = flight.enrichmentHistory;
  const enrichmentDetail = (): string | undefined => {
    if (!history || history.length === 0) return undefined;
    const latest = history[history.length - 1];
    const details: string[] = [];
    if (latest.confidence) details.push(`${t("flights:confidence")}: ${latest.confidence}%`);
    if (latest.sourceFlightsCount)
      details.push(t("flights:sourceFlightsCount", { count: latest.sourceFlightsCount }));
    return details.length ? details.join(" · ") : undefined;
  };

  if (combined) {
    lines.push({ icon: "🔄", label: t("flights:dataSource.live_update_auto") });
  } else if (flight.dataSource && flight.dataSource !== "manual") {
    const icon = SOURCE_ICONS[flight.dataSource];
    if (icon) {
      lines.push({
        icon,
        label: t(`flights:dataSource.${flight.dataSource}`),
        detail: flight.dataSource === "historical_enrichment" ? enrichmentDetail() : undefined,
      });
    }
  }

  if (history && history.length > 0 && flight.dataSource !== "historical_enrichment") {
    lines.push({
      icon: "🔍",
      label:
        history.length > 1
          ? t("flights:enrichmentCount", { count: history.length })
          : t("flights:dataSource.historical_enrichment"),
      detail: enrichmentDetail(),
    });
  }

  if (
    !combined &&
    flight.lastModifiedBy === "auto_update" &&
    flight.dataSource !== "live_update" &&
    flight.dataSource !== "manual"
  ) {
    lines.push({ icon: "🔄", label: t("flights:dataSource.auto_update") });
  }

  return lines;
}
