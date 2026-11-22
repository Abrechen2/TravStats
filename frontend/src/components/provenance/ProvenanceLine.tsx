import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { ProvenanceState } from "../../lib/api/provenance";

/**
 * Where an entry's information comes from, as one quiet line inside the card of the entry it
 * describes — "Aus der Erinnerung · Sommer 1998 · notiert am 2024-05-01". Nothing for an entry
 * whose origin is unknown. The editor is not here: it opens from the card's ⋯.
 */
export default function ProvenanceLine({
  entry,
  className,
}: {
  entry: Partial<ProvenanceState> | null | undefined;
  className?: string;
}): JSX.Element | null {
  const { t } = useTranslation(["provenance"]);
  if (entry?.provenance !== "remembered" && entry?.provenance !== "recorded") return null;
  const parts =
    entry.provenance === "remembered"
      ? [
          t("provenance:line.remembered"),
          entry.rememberedNote,
          entry.rememberedOn
            ? t("provenance:marker.on", { date: entry.rememberedOn.slice(0, 10) })
            : null,
        ]
      : [t("provenance:line.recorded")];
  return (
    <p
      className={className ?? "t-caption"}
      data-testid="provenance-line"
      style={{ color: "var(--text-muted)" }}
    >
      {parts.filter(Boolean).join(" · ")}
    </p>
  );
}
