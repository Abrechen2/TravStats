import type { DetectableFormat, ParseResult, ParserError } from "../../lib/importers/types";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** How many unreadable rows are spelled out before "… and N more". */
const MAX_LISTED = 5;

/**
 * One parser problem as a sentence in the reader's language. A row problem
 * names the LINE of the file (header = line 1), which is what a spreadsheet
 * shows; the parser's 0-based data index ("Row 3") pointed one line above
 * the header-less count and two above the file. An error without a code
 * (a future parser that forgot one) falls back to the generic sentence,
 * never to the parser's English `message`.
 */
export function parserErrorLine(error: ParserError, t: Translate): string {
  const reason = error.code
    ? t(`settings:import.parserErrors.${error.code}`, { value: error.value ?? "" })
    : t("settings:import.parserErrors.unknown");
  if (error.rowIndex < 0) return reason;
  // A parser that knows the file's own line (App in the Air) or entry (an
  // AirTrail JSON list) says so; the header-based count fits CSVs only.
  if (error.entry !== undefined) {
    return t("settings:import.parserErrors.entry", { entry: error.entry, reason });
  }
  return t("settings:import.parserErrors.row", { line: error.line ?? error.rowIndex + 2, reason });
}

/** What each format is recognised by, as the server sends it with `unknownFormat`. */
export type ExpectedColumns = Partial<Record<DetectableFormat, string[]>>;

/** One line per format: its name in the reader's language, then the columns as the file spells them. */
function expectedLines(expected: ExpectedColumns, t: Translate): string[] {
  return (Object.entries(expected) as Array<[DetectableFormat, string[]]>).map(
    ([format, columns]) =>
      `• ${t(`settings:import.tile.tracker.formats.${format}`)}: ${columns.join(", ")}`
  );
}

function listed(errors: ParserError[], t: Translate): string[] {
  const lines = errors.slice(0, MAX_LISTED).map((e) => parserErrorLine(e, t));
  if (errors.length > MAX_LISTED) {
    lines.push(t("settings:import.parserErrors.more", { count: errors.length - MAX_LISTED }));
  }
  return lines;
}

export interface ParseOutcome {
  /** Nothing can be imported: say this and stop. */
  fatal: string | null;
  /** Some rows were unreadable; the rest go on to the preview with this said beside them. */
  skippedNotice: string | null;
}

/**
 * Decides what one bad row costs. It used to cost the whole file: a single
 * impossible date (2024-02-30) among six good flights rejected all six, with
 * "Row 3: Invalid Date: 2024-02-30" in English on the German page
 * (forgejo#88 acceptance, 2026-10-10). A problem with the FILE (headers, the
 * column mapping) still stops everything, since no row can be trusted then;
 * a problem with a ROW skips that row and says so.
 */
export function describeParseResult(
  parsed: ParseResult,
  t: Translate,
  context: { expected?: ExpectedColumns } = {}
): ParseOutcome {
  const fileErrors = parsed.parserErrors.filter((e) => e.rowIndex < 0);
  if (fileErrors.length > 0) {
    // An unknown file says what WOULD have been recognised, so the user can
    // tell a wrong export from a wrong app.
    const unknown = fileErrors.some((e) => e.code === "unknownFormat");
    const extra = unknown && context.expected ? expectedLines(context.expected, t) : [];
    return { fatal: [...listed(fileErrors, t), ...extra].join("\n"), skippedNotice: null };
  }
  const rowErrors = parsed.parserErrors;
  if (parsed.rows.length === 0) {
    return {
      fatal: [t("settings:import.parserErrors.noRows"), ...listed(rowErrors, t)].join("\n"),
      skippedNotice: null,
    };
  }
  if (rowErrors.length === 0) return { fatal: null, skippedNotice: null };
  return {
    fatal: null,
    skippedNotice: [
      t("settings:import.parserErrors.skipped", { count: rowErrors.length }),
      ...listed(rowErrors, t),
    ].join("\n"),
  };
}
