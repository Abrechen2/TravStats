import { parseFr24 } from "./fr24";
import type { ImporterParser, ImporterSource } from "./types";

// Tracker exports (OpenFlights, AirTrail, …) are read on the server
// (`parseTrackerExport` in lib/api/import.ts), so only the browser-side
// parsers are registered here.
export const importers: Record<Extract<ImporterSource, "fr24" | "generic_csv">, ImporterParser> = {
  fr24: parseFr24,
  generic_csv: () => ({
    rows: [],
    parserErrors: [
      {
        rowIndex: -1,
        message: "Generic CSV uses ColumnMappingWizard, not the registry parser",
      },
    ],
  }),
};

export type { PreviewRowInput, ParseResult, ParserError, ImporterSource } from "./types";
export { parseFr24 } from "./fr24";
