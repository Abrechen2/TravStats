import type { JSX } from "react";
import { INPUT, ensureLodging, type EditableRow } from "./lodgingImportRowModel";
import { isGuessedMatch, isMatched, needsLodgingChoice } from "./lodgingImportRowState";

type T = (key: string, options?: Record<string, unknown>) => string;
type OnChange = (sourceRowIndex: number, patch: Partial<EditableRow>) => void;

const NEW_LODGING = "__new__";

export interface IdentityCellProps {
  row: EditableRow;
  t: T;
  onChange: OnChange;
}

/** The name the import gives this row's hotel. */
export function importedName(row: EditableRow): string {
  return row.lodging?.name ?? row.lodgingName ?? "";
}

/**
 * Undo a guessed match. The row becomes an ordinary unmatched one: the
 * fields unlock and "create" now creates a NEW house. The decision the user
 * made is kept, and the action label then says what it will do — a row set
 * to add a stay reads "Hotel und Aufenthalt anlegen" from here on. Every
 * trace of the match goes, the described stay included. A stays-only row
 * gets a house of its own to create (AUD-056). A row whose house was picked
 * from an ambiguous list goes back to that list, so another can be chosen.
 */
function rejectMatchPatch(row: EditableRow): Partial<EditableRow> {
  return {
    matchedLodgingId: null,
    matchedLodgingName: null,
    matchedLodgingCity: null,
    matchIsGuess: false,
    matchedStayId: null,
    matchedStay: null,
    dedupeHint: "none",
    lodgingDedupeHint: "none",
    lodging: ensureLodging(row, importedName(row)),
    ambiguityResolved: (row.lodgingOptions ?? []).length > 0 ? false : row.ambiguityResolved,
  };
}

function chooseLodgingPatch(row: EditableRow, value: string): Partial<EditableRow> | null {
  if (value === NEW_LODGING) {
    return { ambiguityResolved: true, lodging: ensureLodging(row, importedName(row)) };
  }
  const option = (row.lodgingOptions ?? []).find((o) => o.id === value);
  if (!option) return null;
  return {
    matchedLodgingId: option.id,
    matchedLodgingName: option.name,
    matchedLodgingCity: option.city,
    matchIsGuess: true,
    ambiguityResolved: true,
  };
}

/**
 * The hotel a matched row will use, as TEXT: the stored house's own name and
 * city. It was drawn as a greyed-out input showing the import's spelling,
 * which looked editable and named a city ("Zurich") the house is not filed
 * under ("Zürich") — and the commit never writes either.
 */
function MatchedName({ row, t, onChange }: IdentityCellProps): JSX.Element {
  const { sourceRowIndex } = row;
  const storedName = row.matchedLodgingName ?? importedName(row);
  const storedCity = row.matchedLodgingCity ?? null;
  const importCity = row.lodging?.city ?? null;
  const differs =
    importedName(row) !== storedName ||
    (importCity !== null && importCity !== "" && importCity !== storedCity);
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        {t("lodging:import.matchedLodgingLabel")}
      </p>
      <a
        data-testid={`lodging-import-name-${sourceRowIndex}`}
        href={`/lodging/${row.matchedLodgingId}`}
        target="_blank"
        rel="noopener noreferrer"
        title={t("lodging:import.openMatchedLodging")}
        className="font-medium text-[var(--text-primary)] underline-offset-2 hover:underline"
      >
        {storedName}
      </a>
      {differs && (
        <p
          data-testid={`lodging-import-imported-as-${sourceRowIndex}`}
          className="mt-0.5 text-[10px] text-[var(--text-muted)]"
        >
          {t("lodging:import.importedAs")} {importedName(row)}
          {importCity ? `, ${importCity}` : ""}
        </p>
      )}
      {row.decision === "create" && (
        <p
          data-testid={`lodging-import-matched-explain-${sourceRowIndex}`}
          className="mt-1 text-[10px] text-[var(--text-muted)]"
        >
          {t("lodging:import.matchedLodgingExplain")}
        </p>
      )}
      {isGuessedMatch(row) && row.decision !== "skip" && (
        <button
          type="button"
          data-testid={`lodging-import-reject-match-${sourceRowIndex}`}
          onClick={(): void => onChange(sourceRowIndex, rejectMatchPatch(row))}
          className="mt-1 text-[10px] text-[var(--accent)] underline-offset-2 hover:underline"
        >
          {t("lodging:import.rejectMatch")}
        </button>
      )}
    </div>
  );
}

/** Several stored houses fit the name: the reader picks one, or declares it new. */
function LodgingChoice({ row, t, onChange }: IdentityCellProps): JSX.Element {
  const { sourceRowIndex } = row;
  return (
    <div>
      <p className="mb-1 text-[10px] text-[var(--text-muted)]">
        {t("lodging:import.importedAs")} {importedName(row)}
      </p>
      <select
        data-testid={`lodging-import-choose-lodging-${sourceRowIndex}`}
        value=""
        onChange={(e): void => {
          const patch = chooseLodgingPatch(row, e.target.value);
          if (patch) onChange(sourceRowIndex, patch);
        }}
        aria-label={t("lodging:import.chooseLodging")}
        className={INPUT}
      >
        <option value="">{t("lodging:import.chooseLodgingPlaceholder")}</option>
        {(row.lodgingOptions ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.city ? `${o.name} (${o.city})` : o.name}
          </option>
        ))}
        <option value={NEW_LODGING}>{t("lodging:import.chooseLodgingNew")}</option>
      </select>
    </div>
  );
}

export function NameCell({ row, t, onChange }: IdentityCellProps): JSX.Element {
  const { sourceRowIndex } = row;
  const name = importedName(row);
  if (isMatched(row)) return <MatchedName row={row} t={t} onChange={onChange} />;
  if (needsLodgingChoice(row)) return <LodgingChoice row={row} t={t} onChange={onChange} />;
  if (row.decision === "skip") {
    return (
      <span
        data-testid={`lodging-import-name-${sourceRowIndex}`}
        className="text-[var(--text-muted)]"
      >
        {name}
      </span>
    );
  }
  return (
    <input
      data-testid={`lodging-import-name-${sourceRowIndex}`}
      value={name}
      onChange={(e): void =>
        onChange(sourceRowIndex, {
          // Immutable: a NEW lodging object. A name edit on an unmatched row
          // must materialize `row.lodging` — the commit reads only `lodging`
          // / `matchedLodgingId`, so a renamed unresolved row would otherwise
          // fail with `missing_lodging_reference`.
          lodging: { ...ensureLodging(row, name), name: e.target.value },
          lodgingName: e.target.value,
        })
      }
      aria-label={t("lodging:import.fields.name")}
      className={INPUT}
    />
  );
}

export function CityCell({ row, t, onChange }: IdentityCellProps): JSX.Element {
  const { sourceRowIndex } = row;
  // The STORED city of a matched house; the import's spelling is beside the
  // name ("Laut Import"), never presented as the target's.
  if (isMatched(row)) {
    return (
      <span data-testid={`lodging-import-city-${sourceRowIndex}`}>
        {row.matchedLodgingCity ?? ""}
      </span>
    );
  }
  if (needsLodgingChoice(row) || row.decision === "skip") {
    return (
      <span
        data-testid={`lodging-import-city-${sourceRowIndex}`}
        className="text-[var(--text-muted)]"
      >
        {row.lodging?.city ?? ""}
      </span>
    );
  }
  return (
    <input
      data-testid={`lodging-import-city-${sourceRowIndex}`}
      value={row.lodging?.city ?? ""}
      onChange={(e): void =>
        onChange(sourceRowIndex, {
          lodging: { ...ensureLodging(row, importedName(row)), city: e.target.value },
        })
      }
      aria-label={t("lodging:import.fields.city")}
      className={INPUT}
    />
  );
}
