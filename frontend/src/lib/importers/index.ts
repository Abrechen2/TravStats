import { parseFr24 } from "./fr24";
import type { ImporterParser, ImporterSource } from "./types";

export const importers: Record<ImporterSource, ImporterParser> = {
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
