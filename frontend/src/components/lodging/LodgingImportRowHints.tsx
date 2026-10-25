import type { JSX } from "react";
import { matchedStayLabel, type EditableRow } from "./lodgingImportRowModel";
import {
  changeLabel,
  incomingStayLabel,
  liveChanges,
  liveFlags,
  lodgingHintKey,
  needsLodgingChoice,
  rowBlockers,
  stayHintKey,
} from "./lodgingImportRowState";

type T = (key: string, options?: Record<string, unknown>) => string;

const CHIP = "rounded px-1.5 py-0.5 text-[10px]";
const AMBER = `${CHIP} bg-warning/15 text-warning`;
const PROVEN = `${CHIP} bg-success/15 text-success`;
const NEUTRAL = `${CHIP} bg-[var(--bg-surface)] text-[var(--text-muted)]`;

/**
 * Everything the line under an entry can say, derived from the row as it
 * stands. Returned as data so the row can tell whether the line has anything
 * in it without rendering it twice.
 */
export function rowHints(row: EditableRow): {
  flags: ReturnType<typeof liveFlags>;
  lodgingHint: ReturnType<typeof lodgingHintKey>;
  stayHint: ReturnType<typeof stayHintKey>;
  changes: ReturnType<typeof liveChanges>;
  missingCurrency: boolean;
  any: boolean;
} {
  // The ambiguity is said by its own hint, next to the chooser it asks for.
  const flags = liveFlags(row).filter((f) => f !== "ambiguous_lodging_name");
  const lodgingHint = lodgingHintKey(row);
  const stayHint = stayHintKey(row);
  const changes = row.decision === "update" ? liveChanges(row) : [];
  const missingCurrency = rowBlockers(row).includes("missing_currency");
  const any =
    flags.length > 0 ||
    needsLodgingChoice(row) ||
    lodgingHint !== null ||
    stayHint !== null ||
    row.matchedStay != null ||
    changes.length > 0 ||
    missingCurrency;
  return { flags, lodgingHint, stayHint, changes, missingCurrency, any };
}

export interface RowHintsProps {
  row: EditableRow;
  t: T;
  language: string;
  onChange: (sourceRowIndex: number, patch: Partial<EditableRow>) => void;
}

/**
 * The hint line. A proven identity (an import reference) is green; a guess is
 * neutral, because "a hotel of this name exists" is a question to the reader,
 * not a success; anything that needs the reader is amber. All three used to
 * be green, so "Name + Ort" read as settled where it was only the name.
 */
export function RowHints({ row, t, language, onChange }: RowHintsProps): JSX.Element {
  const { sourceRowIndex } = row;
  const { flags, lodgingHint, stayHint, changes, missingCurrency } = rowHints(row);
  const incoming = stayHint === "stay_same_dates" ? incomingStayLabel(row, language, t) : null;

  return (
    <div className="flex flex-wrap gap-1">
      {needsLodgingChoice(row) && (
        <span data-testid={`lodging-import-ambiguous-${sourceRowIndex}`} className={AMBER}>
          {t("lodging:import.flags.ambiguous_lodging_name")}
        </span>
      )}
      {flags.map((flag) => (
        <span
          key={flag}
          data-testid={`lodging-import-flag-${flag}-${sourceRowIndex}`}
          className={flag === "missing_coordinates" ? NEUTRAL : AMBER}
        >
          {t(`lodging:import.flags.${flag}`)}
        </span>
      ))}
      {missingCurrency && (
        <span data-testid={`lodging-import-blocker-currency-${sourceRowIndex}`} className={AMBER}>
          {t("lodging:import.blockers.missing_currency")}
        </span>
      )}
      {/* An unknown chain is an OFFER, never a silent create. Only on a row
          that creates its hotel — a matched row never writes hotel fields,
          so the tick there would decide nothing. */}
      {flags.includes("unknown_chain") && row.lodging?.chainName && (
        <label className="flex items-center gap-1 text-[10px] text-warning">
          <input
            type="checkbox"
            data-testid={`lodging-import-create-chain-${sourceRowIndex}`}
            checked={row.lodging.createChain === true}
            onChange={(e): void =>
              onChange(sourceRowIndex, {
                lodging: { ...row.lodging!, createChain: e.target.checked },
              })
            }
            className="h-3 w-3"
          />
          {t("lodging:import.createChain", { name: row.lodging.chainName })}
        </label>
      )}
      {lodgingHint && (
        <span
          data-testid={`lodging-import-match-hint-${sourceRowIndex}`}
          className={lodgingHint === "lodging_exact_ref" ? PROVEN : NEUTRAL}
        >
          {t(`lodging:import.matchHints.${lodgingHint}`)}
        </span>
      )}
      {stayHint && (
        <span
          data-testid={`lodging-import-stay-hint-${sourceRowIndex}`}
          className={stayHint === "stay_exact_ref" ? PROVEN : NEUTRAL}
        >
          {t(`lodging:import.matchHints.${stayHint}`)}
        </span>
      )}
      {/* A same check-in is not a proven duplicate — so both periods, side
          by side, for the reader to compare. */}
      {incoming && (
        <span
          data-testid={`lodging-import-incoming-stay-${sourceRowIndex}`}
          className="text-[10px] text-[var(--text-muted)]"
        >
          {t("lodging:import.importedStay")} {incoming}
        </span>
      )}
      {/* WHICH stay is already there, not merely that one is. The link opens
          the house that holds it in a new tab, so the import is not lost. */}
      {row.matchedStay && (
        <span
          data-testid={`lodging-import-matched-stay-${sourceRowIndex}`}
          className="text-[10px] text-[var(--text-muted)]"
        >
          {t("lodging:import.matchedStayAt")}{" "}
          <a
            href={row.matchedStay.href}
            target="_blank"
            rel="noopener noreferrer"
            title={t("lodging:import.openMatchedStay")}
            className="underline underline-offset-2"
          >
            {matchedStayLabel(row.matchedStay, language, t)}
          </a>
        </span>
      )}
      {/* A changed booking: say WHAT moves, in the reader's words. */}
      {changes.length > 0 && (
        <span
          data-testid={`lodging-import-changes-${sourceRowIndex}`}
          className={`${CHIP} bg-accent/15 text-accent`}
        >
          {t("lodging:import.changedHint")}: {changes.map((c) => changeLabel(c, t)).join(", ")}
        </span>
      )}
    </div>
  );
}
