import http from "http";
import type { AddressInfo } from "net";
import {
  LODGING_CSV_FIELDS,
  suggestLodgingCsvMapping,
} from "../services/lodging/mappingSuggestion";

jest.mock("../services/parserSettings", () => ({
  getAdminParserSettings: jest.fn(async () => ({
    ollamaUrl: null,
    ollamaModel: null,
  })),
}));

// Same convention as parsers.text.test.ts: mock the whole logger module so
// every degrade path can be asserted on without touching real log files.
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import logger from "../utils/logger";

const warnMock = logger.warn as jest.Mock;
const infoMock = logger.info as jest.Mock;

/** A minimal local stand-in for Ollama's `/api/generate`. Every "LLM" in this
 *  suite is one of these — no test ever dials a real model. */
function createMockOllamaServer(handler: http.RequestListener): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

function respondJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Wraps the model's raw text output in Ollama's `/api/generate` envelope. */
function ollamaEnvelope(responseText: string): { response: string } {
  return { response: responseText };
}

const HEADERS = ["Hotel", "Anreise", "Abreise"];
const SAMPLE_ROWS = [
  { Hotel: "NH Frankfurt", Anreise: "05.01.2026", Abreise: "07.01.2026" },
];

describe("suggestLodgingCsvMapping", () => {
  beforeEach(() => {
    warnMock.mockClear();
    infoMock.mockClear();
  });

  it("returns an empty mapping when Ollama is unreachable — never throws", async () => {
    const mapping = await suggestLodgingCsvMapping(
      ["Hotel", "Anreise"],
      [{ Hotel: "NH", Anreise: "30.03.2026" }],
      {
        url: "http://127.0.0.1:1",
        model: "nonexistent",
      },
    );
    expect(mapping).toEqual({});
    expect(warnMock).toHaveBeenCalled();
  });

  it("exposes every field the CSV importer can map", () => {
    expect(LODGING_CSV_FIELDS).toContain("name");
    expect(LODGING_CSV_FIELDS).toContain("googlePlaceId");
    expect(LODGING_CSV_FIELDS).toContain("checkIn");
    expect(LODGING_CSV_FIELDS).toContain("ratingBreakfast");
    expect(new Set(LODGING_CSV_FIELDS).size).toBe(LODGING_CSV_FIELDS.length);
  });

  describe("sanitize() degrade paths — the LLM must never poison the mapping", () => {
    it("drops a pair whose header is not in the uploaded file, keeps the rest", async () => {
      const server = await createMockOllamaServer((req, res) => {
        respondJson(
          res,
          200,
          ollamaEnvelope(
            JSON.stringify({
              mapping: { name: "Hotel", checkIn: "SomeColumnNotInTheCsv" },
            }),
          ),
        );
      });
      try {
        const mapping = await suggestLodgingCsvMapping(HEADERS, SAMPLE_ROWS, {
          url: server.url,
          model: "mock",
        });
        expect(mapping).toEqual({ name: "Hotel" });
        expect(warnMock).toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });

    it("drops a pair whose field name does not exist, keeps the rest", async () => {
      const server = await createMockOllamaServer((req, res) => {
        respondJson(
          res,
          200,
          ollamaEnvelope(
            JSON.stringify({
              mapping: { name: "Hotel", totallyMadeUpField: "Anreise" },
            }),
          ),
        );
      });
      try {
        const mapping = await suggestLodgingCsvMapping(HEADERS, SAMPLE_ROWS, {
          url: server.url,
          model: "mock",
        });
        expect(mapping).toEqual({ name: "Hotel" });
        expect(warnMock).toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });

    it("drops the collision when two fields map to the same header, applies it only once", async () => {
      const server = await createMockOllamaServer((req, res) => {
        respondJson(
          res,
          200,
          ollamaEnvelope(
            JSON.stringify({
              // "name" is listed first — it must win; "chainName" claiming
              // the same header afterwards must be dropped, not silently
              // applied on top of (or instead of) the first.
              mapping: { name: "Hotel", chainName: "Hotel" },
            }),
          ),
        );
      });
      try {
        const mapping = await suggestLodgingCsvMapping(HEADERS, SAMPLE_ROWS, {
          url: server.url,
          model: "mock",
        });
        expect(mapping).toEqual({ name: "Hotel" });
        expect(Object.values(mapping)).toEqual(["Hotel"]); // exactly one field claims the header
        expect(warnMock).toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });

    it("returns {} when the model returns prose instead of JSON", async () => {
      const server = await createMockOllamaServer((req, res) => {
        respondJson(
          res,
          200,
          ollamaEnvelope("Sure! I'd map Hotel to name and Anreise to checkIn."),
        );
      });
      try {
        const mapping = await suggestLodgingCsvMapping(HEADERS, SAMPLE_ROWS, {
          url: server.url,
          model: "mock",
        });
        expect(mapping).toEqual({});
        expect(warnMock).toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });

    it.each([
      ['{"mapping":"foo"}', '{"mapping":"foo"}'],
      ['{"mapping":123}', '{"mapping":123}'],
      ["a top-level array", "[1,2,3]"],
      ["a top-level string", JSON.stringify("just a string")],
      ["null", "null"],
    ])(
      "returns {} for valid JSON of the wrong shape: %s",
      async (_label, modelText) => {
        const server = await createMockOllamaServer((req, res) => {
          respondJson(res, 200, ollamaEnvelope(modelText));
        });
        try {
          const mapping = await suggestLodgingCsvMapping(HEADERS, SAMPLE_ROWS, {
            url: server.url,
            model: "mock",
          });
          expect(mapping).toEqual({});
          expect(warnMock).toHaveBeenCalled();
        } finally {
          await server.close();
        }
      },
    );

    it("returns {} when Ollama responds with a non-200 status", async () => {
      const server = await createMockOllamaServer((req, res) => {
        respondJson(res, 500, { error: "internal server error" });
      });
      try {
        const mapping = await suggestLodgingCsvMapping(HEADERS, SAMPLE_ROWS, {
          url: server.url,
          model: "mock",
        });
        expect(mapping).toEqual({});
        expect(warnMock).toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });

    it("returns {} when the response body exceeds the size cap", async () => {
      const server = await createMockOllamaServer((req, res) => {
        // The client aborts the connection once the cap is exceeded, which
        // can surface as a write-after-destroy error server-side — swallow
        // it, it is expected and not what this test is checking.
        res.on("error", () => {});
        res.writeHead(200, { "Content-Type": "application/json" });
        // Well over the 2MB cap — never valid JSON, and must never be
        // buffered in full before being rejected.
        const chunk = "x".repeat(1_000_000);
        for (let i = 0; i < 4; i += 1) res.write(chunk);
        res.end();
      });
      try {
        const mapping = await suggestLodgingCsvMapping(HEADERS, SAMPLE_ROWS, {
          url: server.url,
          model: "mock",
        });
        expect(mapping).toEqual({});
        expect(warnMock).toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });

    it("succeeds normally when the model returns a fully valid mapping", async () => {
      const server = await createMockOllamaServer((req, res) => {
        respondJson(
          res,
          200,
          ollamaEnvelope(
            JSON.stringify({
              mapping: {
                name: "Hotel",
                checkIn: "Anreise",
                checkOut: "Abreise",
              },
            }),
          ),
        );
      });
      try {
        const mapping = await suggestLodgingCsvMapping(HEADERS, SAMPLE_ROWS, {
          url: server.url,
          model: "mock",
        });
        expect(mapping).toEqual({
          name: "Hotel",
          checkIn: "Anreise",
          checkOut: "Abreise",
        });
        expect(infoMock).toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });
  });

  describe("timeout — a real deadline, not an idle timer", () => {
    afterEach(() => {
      delete process.env.LODGING_MAPPING_TIMEOUT_MS;
    });

    it("bounds a hanging generate call even while the server keeps trickling bytes", async () => {
      process.env.LODGING_MAPPING_TIMEOUT_MS = "300";
      let intervalHandle: NodeJS.Timeout | undefined;
      const server = await createMockOllamaServer((req, res) => {
        // The client destroys the connection once the deadline fires, which
        // can surface as a write-after-destroy error server-side — swallow
        // it, it is expected and not what this test is checking.
        res.on("error", () => {});
        res.writeHead(200, { "Content-Type": "application/json" });
        // Send a byte every 50ms — well past the 300ms budget in total. An
        // idle-timer implementation (`req.setTimeout`) would reset on every
        // one of these writes and never fire; a real deadline fires anyway.
        intervalHandle = setInterval(() => {
          res.write(" ");
        }, 50);
      });
      try {
        const start = Date.now();
        const mapping = await suggestLodgingCsvMapping(HEADERS, SAMPLE_ROWS, {
          url: server.url,
          model: "mock",
        });
        const elapsedMs = Date.now() - start;
        expect(mapping).toEqual({});
        expect(warnMock).toHaveBeenCalled();
        // Bounded close to the overridden 300ms deadline, nowhere near the
        // ~1s+ of continuous trickle the mock server would otherwise sustain.
        expect(elapsedMs).toBeLessThan(2_000);
      } finally {
        if (intervalHandle) clearInterval(intervalHandle);
        await server.close();
      }
    });
  });

  describe("privacy — CSV content and the model's raw response are never logged", () => {
    it("never leaks header names, sample-row values, or the model's prose into logs", async () => {
      const secretHeaders = ["Hotel", "VERY_SENSITIVE_HEADER_MARKER_998"];
      const secretRows = [
        {
          Hotel: "NH",
          VERY_SENSITIVE_HEADER_MARKER_998: "TOP_SECRET_ROW_VALUE_123",
        },
      ];
      const proseMarker =
        "I cannot map TOP_SECRET_ROW_VALUE_123, sorry about that.";
      const server = await createMockOllamaServer((req, res) => {
        respondJson(res, 200, ollamaEnvelope(proseMarker));
      });
      try {
        const mapping = await suggestLodgingCsvMapping(
          secretHeaders,
          secretRows,
          {
            url: server.url,
            model: "mock",
          },
        );
        expect(mapping).toEqual({});

        const allLoggedText = JSON.stringify([
          ...warnMock.mock.calls,
          ...infoMock.mock.calls,
        ]);
        expect(allLoggedText).not.toContain("VERY_SENSITIVE_HEADER_MARKER_998");
        expect(allLoggedText).not.toContain("TOP_SECRET_ROW_VALUE_123");
        expect(allLoggedText).not.toContain(proseMarker);
      } finally {
        await server.close();
      }
    });
  });
});
