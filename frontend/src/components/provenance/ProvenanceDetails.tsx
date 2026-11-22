import { useTranslation } from "../../hooks/useTranslation";
import type { ProvenanceEntryType, ProvenanceState } from "../../lib/api/provenance";
import RememberedEditor from "./RememberedEditor";
import RememberedMarker from "./RememberedMarker";
import PurposeChip from "../purpose/PurposeChip";
import PurposeEditor from "../purpose/PurposeEditor";

/**
 * The origin of an entry on its detail page: the "aus der Erinnerung" marker, and — folded away
 * until asked for — the editor. One component for every domain, so they cannot drift apart.
 */
export default function ProvenanceDetails({
  entryType,
  entry,
  onSaved,
}: {
  entryType: ProvenanceEntryType;
  entry: Partial<ProvenanceState> & { id: string; purpose?: string | null };
  onSaved?: (state: ProvenanceState) => void;
}): JSX.Element {
  const { t } = useTranslation(["provenance"]);
  return (
    <details className="t-caption" data-testid={`provenance-details-${entry.id}`}>
      <summary className="flex flex-wrap items-center gap-2" style={{ cursor: "pointer" }}>
        {t("provenance:editor.legend")}
        <RememberedMarker entry={entry} />
        <PurposeChip entry={entry} />
      </summary>
      <div style={{ marginTop: "var(--ts-space-sm)" }}>
        <RememberedEditor
          // Re-keyed on what is stored, so a reload shows the saved state, not the typed one.
          key={`${entry.provenance ?? ""}|${entry.rememberedOn ?? ""}|${entry.rememberedNote ?? ""}`}
          entryType={entryType}
          entryId={entry.id}
          initial={entry}
          onSaved={onSaved}
        />
        {entryType !== "trip" && (
          <div style={{ marginTop: "var(--ts-space-md)" }}>
            <PurposeEditor
              key={`purpose-${entry.purpose ?? ""}`}
              entryType={entryType}
              entryId={entry.id}
              purpose={entry.purpose}
            />
          </div>
        )}
      </div>
    </details>
  );
}
