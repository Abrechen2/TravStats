import { apiErrorMachineCode } from "./apiError";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The server's stable parse-failure codes → the reader's language. */
const CODE_KEYS: Record<string, string> = {
  LLM_UNREACHABLE: "import:errors.llmUnreachable",
  INVALID_PDF: "import:errors.invalidPdf",
  PDF_NO_TEXT: "import:errors.pdfNoText",
  NO_FLIGHT_DATA: "flights:scanner.noFlightData",
};

/**
 * What to tell the reader when a document parse failed.
 *
 * The import drop zone and the boarding-pass scanner used to print the
 * server's `message` or `error` — English prose ("Invalid PDF", "No flight data
 * could be extracted from the boarding pass", raw exception text) — or axios's
 * own "Request failed with status code 400" into a German page. They branch on
 * the code now and never print server prose.
 */
export function parseFailureMessage(err: unknown, t: Translate, fallbackKey: string): string {
  const code = apiErrorMachineCode(err);
  if (code && CODE_KEYS[code]) return t(CODE_KEYS[code]);
  const e = err as { response?: { status?: number }; code?: string; message?: string } | undefined;
  const status = e?.response?.status;
  if (status === 429) return t("import:errors.rateLimited");
  if (status === 503) return t("import:errors.llmUnreachable");
  if (!e?.response && (e?.code === "ECONNABORTED" || /timeout/i.test(e?.message ?? ""))) {
    return t("import:errors.timeout");
  }
  return t(fallbackKey);
}

/**
 * What to tell the reader when saving a record failed — never axios's
 * "Request failed with status code 400".
 */
export function saveFailureMessage(err: unknown, t: Translate, fallbackKey: string): string {
  const e = err as { response?: { status?: number } } | undefined;
  const status = e?.response?.status;
  if (!e?.response) return t(fallbackKey);
  if (status === 400) return t("errors:saveRejected");
  if (status === 403) return t("errors:forbidden");
  if (status === 404) return t("errors:notFound");
  if (status === 429) return t("errors:tooManyRequests");
  return t(fallbackKey);
}
