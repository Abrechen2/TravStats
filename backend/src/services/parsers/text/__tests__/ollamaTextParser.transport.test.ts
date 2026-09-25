import http from "http";
import type { AddressInfo } from "net";

import { OllamaTextParser } from "../ollamaTextParser";

jest.mock("../../../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

/**
 * What the flight parser does with a provider that refuses, and with one that
 * never answers. Both were measured on 2.7.0-beta.13 (2026-09-20).
 *
 * SRV-LLM-HTTP-001 — the local provider answered `HTTP 503` and the parser
 * took its body anyway, because the hand-rolled `fetchJson` resolved on `end`
 * without ever looking at the status line. `/parse-email` then reported
 * `parserUsed=ollama` with HTTP 200 and the model's QA9500 candidate: a
 * refusal presented as a parse.
 *
 * SRV-LLM-TIMEOUT-001 — a provider that accepted the request and then went
 * silent held the parser for its 300 s budget, while the reverse proxy killed
 * the whole request at 60 s. The caller got no parser error and no regex
 * fallback, although `parsers/email.ts` falls back on a throwing provider —
 * it simply never got the throw in time.
 */
describe("Ollama text parser transport", () => {
  let server: http.Server;
  let url: string;
  let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  beforeAll(async () => {
    server = http.createServer((req, res) => respond(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  });

  afterEach(() => {
    delete process.env.LLM_PARSE_TIMEOUT_MS;
  });

  /** A body the parser would happily believe if it ever looked at it. */
  const PLAUSIBLE_BODY = JSON.stringify({
    response: JSON.stringify([
      {
        flightNumber: "QA9500",
        departureCode: "MUC",
        arrivalCode: "CDG",
        departureTime: "2025-07-10T08:00",
        arrivalTime: "2025-07-10T09:40",
      },
    ]),
  });

  it("refuses a candidate the provider sent with HTTP 503, rather than parsing the refusal", async () => {
    respond = (_req, res) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(PLAUSIBLE_BODY);
    };

    const parser = new OllamaTextParser(url, "audit-model");
    await expect(parser.parseEmail("Booking", "Flug QA9500 MUC CDG")).rejects.toThrow(/503/);
  });

  it("reports a provider that answers HTTP 503 to /api/tags as unavailable", async () => {
    respond = (_req, res) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [] }));
    };

    const parser = new OllamaTextParser(url, "audit-model");
    await expect(parser.checkAvailability()).resolves.toMatchObject({ available: false });
  });

  it("still accepts a normal 200", async () => {
    respond = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(PLAUSIBLE_BODY);
    };

    const parser = new OllamaTextParser(url, "audit-model");
    const flights = await parser.parseEmail("Booking", "Flug QA9500 MUC CDG");
    expect(flights).toHaveLength(1);
    expect(flights[0].flightNumber).toBe("QA9500");
  });

  it("gives up inside its budget when the provider accepts the request and never answers", async () => {
    // Held open deliberately: no status line, no body, no socket close — the
    // exact shape that outlived the request in the measurement above.
    respond = () => {};
    process.env.LLM_PARSE_TIMEOUT_MS = "300";

    const parser = new OllamaTextParser(url, "audit-model");
    const startedAt = Date.now();
    await expect(parser.parseEmail("Booking", "Flug QA9500 MUC CDG")).rejects.toThrow(/timeout/i);
    // The point is not the exact number — it is that the parser answers at all
    // while the caller is still there. A budget it does not hold is no budget.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});
