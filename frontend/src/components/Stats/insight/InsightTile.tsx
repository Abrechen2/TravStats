import type { JSX, ReactNode } from "react";
import EvidenceTrigger from "../EvidenceTrigger";
import { STAT_CARD_CLASS, STAT_CARD_STYLE } from "../StatCard";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";
import CountingHelp from "../counting/CountingHelp";
import type { CountingSource } from "../counting/countingEntry";
import EntryLinks, { type EntryLink } from "./EntryLinks";

export interface InsightEvidence {
  key: string;
  scope: EvidenceScopeParams;
  renderedValue: number | null;
}

interface InsightTileProps {
  title: string;
  /** `null` means the data cannot answer — `empty` is shown instead, never a 0. */
  value: ReactNode | null;
  /** Says which data the user already HAS would answer it; never asks for new input. */
  empty: string;
  description?: ReactNode;
  /** The five counting answers of this figure; the tile's title names it. */
  help: CountingSource;
  /** Only for a figure whose measure the evidence panel serves. */
  evidence?: InsightEvidence;
  entries?: readonly EntryLink[];
  accent: string;
  children?: ReactNode;
  testId?: string;
}

/**
 * One figure of the statistics expansion: the number, what it is made of, and
 * how it was counted.
 *
 * The card is a `<div>`, not a button, because it holds two disclosures of its
 * own; only the NUMBER opens the evidence panel (the nesting rule
 * `StatCard.descriptionHasOwnTrigger` exists for).
 */
export default function InsightTile({
  title,
  value,
  empty,
  description,
  help,
  evidence,
  entries,
  accent,
  children,
  testId,
}: InsightTileProps): JSX.Element {
  const figure =
    value === null ? (
      <p className="text-sm text-(--text-muted)" data-testid={testId && `${testId}-empty`}>
        {empty}
      </p>
    ) : (
      <p className="mb-1 text-3xl font-bold" style={{ color: accent }}>
        {value}
      </p>
    );
  return (
    <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE} data-testid={testId}>
      <h3 className="mb-2 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      {evidence && value !== null ? (
        <EvidenceTrigger
          kind="metric"
          evidenceKey={evidence.key}
          scope={evidence.scope}
          renderedValue={evidence.renderedValue}
          label={title}
          className="block"
        >
          {figure}
        </EvidenceTrigger>
      ) : (
        figure
      )}
      {description && value !== null && <p className="text-sm opacity-75">{description}</p>}
      {children}
      {entries && <EntryLinks entries={entries} testId={testId && `${testId}-entries`} />}
      <CountingHelp entries={[{ term: title, ...help }]} testId={testId && `${testId}-help`} />
    </div>
  );
}
