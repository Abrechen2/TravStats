import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { parseFr24 } from "../../../lib/importers/fr24";
import { describeParseResult, parserErrorLine } from "../parserErrorCopy";

const postImportPreview = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/import", () => ({ postImportPreview }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));

import { Fr24ImportTile } from "../Fr24ImportTile";

const t = (k: string, o?: Record<string, unknown>): string => (o ? `${k} ${JSON.stringify(o)}` : k);

const HEADER =
  "Date,Flight number,From,To,Dep time,Arr time,Duration,Airline,Aircraft,Registration,Seat number,Seat type,Flight class,Flight reason,Note";
const row = (date: string, fn: string): string =>
  `${date},${fn},Frankfurt (FRA/EDDF),New York (JFK/KJFK),10:05:00,12:55:00,08:50:00,,,,,,1,1,`;
// Six flights, the fourth on a day that does not exist.
const CSV = [
  HEADER,
  row("2024-03-01", "LH400"),
  row("2024-03-10", "LH401"),
  row("2024-05-20", "LH402"),
  row("2024-02-30", "LH403"),
  row("2024-07-02", "LH404"),
  row("2024-08-15", "LH405"),
].join("\n");

/**
 * forgejo#88 acceptance, 2026-10-10: one impossible date among six good
 * flights rejected the whole file, with "Row 3: Invalid Date: 2024-02-30"
 * in English on the German page — and "Row 3" was line 5 of the file.
 */
describe("an import with one unreadable row", () => {
  it("keeps the five good rows and says which line was skipped, by its file line", () => {
    const parsed = parseFr24(CSV);
    expect(parsed.rows).toHaveLength(5);
    const outcome = describeParseResult(parsed, t);
    expect(outcome.fatal).toBeNull();
    expect(outcome.skippedNotice).toContain('settings:import.parserErrors.skipped {"count":1}');
    expect(outcome.skippedNotice).toContain('"line":5');
    expect(outcome.skippedNotice).toContain("settings:import.parserErrors.invalidDate");
    expect(outcome.skippedNotice).not.toMatch(/Invalid Date|Row \d/);
  });

  it("still stops on a file problem, in the reader's language", () => {
    const outcome = describeParseResult(parseFr24("Foo,Bar\n1,2"), t);
    expect(outcome.fatal).toContain("settings:import.parserErrors.missingHeader");
    expect(outcome.fatal).not.toMatch(/Missing required header/);
  });

  it("stops when no row at all is readable", () => {
    const outcome = describeParseResult(parseFr24([HEADER, row("2024-02-30", "X")].join("\n")), t);
    expect(outcome.fatal).toContain("settings:import.parserErrors.noRows");
  });

  it("never falls back to a parser's English message", () => {
    expect(parserErrorLine({ rowIndex: 0, message: "Something odd" }, t)).not.toContain(
      "Something odd"
    );
  });

  it("the tile opens the preview with the good rows and the notice", async () => {
    postImportPreview.mockResolvedValue({
      rows: [],
      summary: { ok: 5, problems: 0, duplicates: 0, unresolvable: 0 },
    });
    const { container } = render(<Fr24ImportTile />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([CSV], "fr24.csv", { type: "text/csv" });
    // jsdom's File has no text(); the tile reads the file through it.
    Object.defineProperty(file, "text", { value: () => Promise.resolve(CSV) });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(postImportPreview).toHaveBeenCalledTimes(1));
    expect(postImportPreview.mock.calls[0][0]).toHaveLength(5);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "settings:import.parserErrors.skipped"
    );
  });
});
