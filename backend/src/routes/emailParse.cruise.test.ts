import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockParseCruiseBookingText = jest.fn();
const mockResolveCruiseEntities = jest.fn();
// Pass-through hydration: keep input/shipMatched/unmatchedPorts, add empty
// display objects (matches the real signature's enrichment).
const mockHydrateResolvedCruises = jest.fn(
  async (resolved: Array<Record<string, unknown>>) =>
    resolved.map((r) => ({
      ...r,
      ship: null,
      departurePort: null,
      arrivalPort: null,
      stopPorts: {},
    }))
);
const mockParseBookingEmail = jest.fn();
const mockExtractEmailFromFile = jest.fn();

jest.mock("../services/cruiseBookingParser", () => ({
  parseCruiseBookingText: mockParseCruiseBookingText,
}));
jest.mock("../services/cruiseEntityResolver", () => ({
  resolveCruiseEntities: mockResolveCruiseEntities,
  hydrateResolvedCruises: mockHydrateResolvedCruises,
}));
jest.mock("../services/bookingParser", () => ({
  parseBookingEmail: mockParseBookingEmail,
}));
jest.mock("../services/emailExtractor", () => ({
  extractEmailFromFile: mockExtractEmailFromFile,
}));
jest.mock("../middleware/auth", () => ({
  authenticate: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = "test-user";
    next();
  },
}));
jest.mock("../middleware/rateLimit", () => ({
  emailParseLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock("../middleware/upload", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const multer = require("multer") as typeof import("multer");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os") as typeof import("os");
  return {
    // Disk storage so `file.path` exists — the route reads via `fs.readFileSync(filePath)`.
    uploadEmailFile: multer({ dest: os.tmpdir() }),
    // The route rebuilds the cleanup path as join(getEmailUploadDir(), basename(file.filename));
    // point it at the same dir the mock multer writes to so the path resolves.
    getEmailUploadDir: () => os.tmpdir(),
  };
});
jest.mock("../utils/fileValidation", () => ({
  validateEmailFile: () => ({ valid: true }),
}));
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import request from "supertest";
import express from "express";

describe("POST /parse-email — cruise domain", () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    mockParseCruiseBookingText.mockReset();
    mockResolveCruiseEntities.mockReset();
    mockParseBookingEmail.mockReset();
    const { default: emailParseRouter } = await import("./emailParse");
    app = express();
    app.use(express.json());
    app.use("/", emailParseRouter);
  });

  it("dispatches cruise email body to cruise parser + entity resolver", async () => {
    mockParseCruiseBookingText.mockResolvedValue({
      cruises: [
        {
          shipNameOverride: "AIDAprima",
          startDate: "2026-06-01",
          endDate: "2026-06-08",
          stops: [],
        },
      ],
      parserUsed: "ollama",
      ollamaAvailable: true,
    });
    mockResolveCruiseEntities.mockImplementation(async (input: unknown) => ({
      input,
      shipMatched: true,
      unmatchedPorts: [],
    }));

    const res = await request(app)
      .post("/parse-email")
      .send({
        emailContent: "Buchungsbestätigung AIDAprima ...",
        subject: "Ihre Kreuzfahrtbuchung",
        domain: "cruise",
      });

    expect(res.status).toBe(200);
    expect(res.body.domain).toBe("cruise");
    expect(res.body.cruises).toHaveLength(1);
    expect(res.body.cruises[0].shipMatched).toBe(true);
    expect(res.body.parserUsed).toBe("ollama");
    expect(mockParseCruiseBookingText).toHaveBeenCalledTimes(1);
    expect(mockResolveCruiseEntities).toHaveBeenCalledTimes(1);
    // Email + flight parser must NOT have been touched.
    expect(mockParseBookingEmail).not.toHaveBeenCalled();
  });

  it("still routes flight requests to the flight parser", async () => {
    mockParseBookingEmail.mockResolvedValue({
      flights: [{ flightNumber: "LH123" }],
      parserUsed: "ollama",
      ollamaAvailable: true,
    });

    const res = await request(app)
      .post("/parse-email")
      .send({
        emailContent: "Booking confirmation LH123",
        subject: "Your flight",
        domain: "flight",
      });

    expect(res.status).toBe(200);
    expect(res.body.flights).toHaveLength(1);
    expect(mockParseBookingEmail).toHaveBeenCalledTimes(1);
    expect(mockParseCruiseBookingText).not.toHaveBeenCalled();
  });
});

describe("POST /parse-email-file — cruise domain", () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    mockParseCruiseBookingText.mockReset();
    mockResolveCruiseEntities.mockReset();
    mockExtractEmailFromFile.mockReset();
    const { default: emailParseRouter } = await import("./emailParse");
    app = express();
    app.use("/", emailParseRouter);
  });

  it("extracts text from email file and dispatches to cruise parser", async () => {
    mockExtractEmailFromFile.mockReturnValue({
      subject: "Kreuzfahrtbuchung",
      text: "AIDAprima 01.06.2026 – 08.06.2026",
      html: undefined,
    });
    mockParseCruiseBookingText.mockResolvedValue({
      cruises: [{ shipNameOverride: "AIDAprima", stops: [] }],
      parserUsed: "ollama",
      ollamaAvailable: true,
    });
    mockResolveCruiseEntities.mockImplementation(async (input: unknown) => ({
      input,
      shipMatched: true,
      unmatchedPorts: [],
    }));

    const res = await request(app)
      .post("/parse-email-file")
      .field("domain", "cruise")
      .attach("email", Buffer.from("dummy email body"), {
        filename: "booking.eml",
        contentType: "message/rfc822",
      });

    expect(res.status).toBe(200);
    expect(res.body.domain).toBe("cruise");
    expect(res.body.cruises).toHaveLength(1);
    expect(mockExtractEmailFromFile).toHaveBeenCalledTimes(1);
    expect(mockParseCruiseBookingText).toHaveBeenCalledTimes(1);
  });
});
