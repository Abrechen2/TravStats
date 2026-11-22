import { useTranslation } from "../../hooks/useTranslation";
import type { ProvenanceState } from "../../lib/api/provenance";

/**
 * The quiet "aus der Erinnerung" chip of an entry typed in from memory — its dates are
 * approximate. The note and the day it was written down sit in the tooltip AND are read out
 * (`aria-label`), so the meaning does not rest on colour or on hovering. Renders nothing for an
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
    entry.rememberedOn ? t("provenance:marker.on", { date: entry.rememberedOn }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const title = detail
    ? `${t("provenance:marker.title")} — ${detail}`
    : t("provenance:marker.title");
  return (
    <span
      className="t-caption"
      data-testid="remembered-marker"
      title={title}
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
  );
}
