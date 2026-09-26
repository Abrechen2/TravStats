import { describe, it, expect } from "vitest";
import { parseFailureMessage } from "../parseErrorCopy";

/** `t` echoes the key, so each assertion names the sentence the reader gets. */
const t = (key: string): string => key;
const httpError = (status: number, data: Record<string, unknown> = {}) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });

describe("parseFailureMessage — codes, not prose", () => {
  it.each([
    ["NO_FLIGHT_DATA", 422, "flights:scanner.noFlightData"],
    ["INVALID_PDF", 400, "import:errors.invalidPdf"],
    ["PDF_NO_TEXT", 422, "import:errors.pdfNoText"],
    ["LLM_UNREACHABLE", 503, "import:errors.llmUnreachable"],
  ])("%s → %s", (code, status, key) => {
    const err = httpError(status, { error: "English prose", code });
    expect(parseFailureMessage(err, t, "fallback")).toBe(key);
  });

  it("reads a 429 and a client timeout for what they are", () => {
    expect(parseFailureMessage(httpError(429), t, "fallback")).toBe("import:errors.rateLimited");
    const timeout = Object.assign(new Error("timeout of 180000ms exceeded"), {
      code: "ECONNABORTED",
    });
    expect(parseFailureMessage(timeout, t, "fallback")).toBe("import:errors.timeout");
  });

  it("never returns the server's words for an unknown failure", () => {
    const err = httpError(500, { error: "Boarding pass parsing failed", message: "boom" });
    expect(parseFailureMessage(err, t, "errors:boardingPassError")).toBe(
      "errors:boardingPassError"
    );
  });
});
