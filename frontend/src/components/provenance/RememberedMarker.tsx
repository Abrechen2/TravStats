import { useTranslation } from "../../hooks/useTranslation";
import HelpIcon from "../Help/HelpIcon";
import type { ProvenanceState } from "../../lib/api/provenance";

/**
 * The quiet "aus der Erinnerung" chip of an entry typed in from memory — its dates are
 * approximate. The note and the day it was written down sit in a tap/keyboard help (`HelpIcon`,
 * not a hover-only title) AND are read out (`aria-label`), so the meaning does not rest on colour
 * or on hovering. Renders nothing for an
 * entry that is recorded or whose origin is unknown.
 */
export default function RememberedMarker({
  entry,
}: {
  entry: Partial<ProvenanceState> | null | undefined;
}): JSX.Element | null {
  const { t } = useTranslation(["provenance"]);
  if (entry?.provenance !== "remembered") return null;
  const detail = [
    entry.rememberedNote,
    entry.rememberedOn
      ? t("provenance:marker.on", { date: entry.rememberedOn.slice(0, 10) })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const title = detail
    ? `${t("provenance:marker.title")} — ${detail}`
    : t("provenance:marker.title");
  return (
    <span
      className="inline-flex items-center gap-1"
      // Rows that open on click or Enter contain this marker: its help must not open the row.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span
        className="t-caption"
        data-testid="remembered-marker"
        aria-label={title}
        style={{
          fontStyle: "italic",
          border: "1px dashed var(--ts-border)",
          borderRadius: 999,
          padding: "0 var(--ts-space-sm)",
          whiteSpace: "nowrap",
        }}
      >
        {t("provenance:marker.label")}
      </span>
      <HelpIcon content={title} subject={t("provenance:marker.label")} />
    </span>
  );
}
