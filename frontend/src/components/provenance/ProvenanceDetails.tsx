import { useTranslation } from "../../hooks/useTranslation";
import type { ProvenanceEntryType, ProvenanceState } from "../../lib/api/provenance";
import RememberedEditor from "./RememberedEditor";
import RememberedMarker from "./RememberedMarker";
import PurposeChip from "../purpose/PurposeChip";
import PurposeEditor from "../purpose/PurposeEditor";

/**
 * The origin of an entry on its detail page: the "aus der Erinnerung" marker, and — folded away
 * until asked for — the editor; beside it, in a block of its own, the entry's purpose. One
 * component for every domain, so they cannot drift apart.
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
  const { t } = useTranslation(["provenance", "purpose"]);
  return (
    <>
      <details className="t-caption" data-testid={`provenance-details-${entry.id}`}>
        <summary className="flex flex-wrap items-center gap-2" style={{ cursor: "pointer" }}>
          {t("provenance:editor.legend")}
          <RememberedMarker entry={entry} />
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
        </div>
      </details>
      {/* The purpose is not an origin: it sat folded inside "Herkunft der Angaben" and read as
          one of its answers (UAT rc.45). It has its own place, with what it means beside it. */}
      {entryType !== "trip" && (
        <details
          className="t-caption"
          data-testid={`purpose-details-${entry.id}`}
          style={{ marginTop: "var(--ts-space-sm)" }}
        >
          <summary className="flex flex-wrap items-center gap-2" style={{ cursor: "pointer" }}>
            {t("purpose:field.legend")}
            <PurposeChip entry={entry} />
          </summary>
          <div style={{ marginTop: "var(--ts-space-sm)" }}>
            <PurposeEditor
              key={`purpose-${entry.purpose ?? ""}`}
              entryType={entryType}
              entryId={entry.id}
              purpose={entry.purpose}
            />
          </div>
        </details>
      )}
    </>
  );
}
