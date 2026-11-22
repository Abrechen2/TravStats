import { readBoardingPass } from "../boardingPassRead";
import { scanBarcodesFromImageBase64 } from "../../utils/barcodeImage";
import { getParserConfig, parseBoardingPass } from "../parsers/factory";
import { getTextParserInstance } from "../parsers/providers";
import { lookupFlightWithHistorical } from "../flightLookup";

/**
 * The stage contract of reading a boarding pass (owner report 2026-11-22: the
 * scan "skipped straight to the model", left the times empty although the
 * pass prints them, and ended in a vague error). Every external half is
 * mocked; what is under test is order, gating and the recorded outcome.
 */
jest.mock("../../utils/barcodeImage", () => ({ scanBarcodesFromImageBase64: jest.fn() }));
jest.mock("../parsers/factory", () => ({
  ...jest.requireActual("../parsers/factory"),
  getParserConfig: jest.fn(),
  parseBoardingPass: jest.fn(),
}));
jest.mock("../parsers/providers", () => ({
  ...jest.requireActual("../parsers/providers"),
  getTextParserInstance: jest.fn(),
}));
jest.mock("../flightLookup", () => ({ lookupFlightWithHistorical: jest.fn() }));
// One image per pass, named so a test can tell them apart.
jest.mock("../boardingPass/bands", () => ({
  cropPassBands: (_image: string, boxes: unknown[]) => boxes.map((_, i) => `band-${i}`),
}));
jest.mock("../parsers/vision/tesseractParser", () => ({
  getTesseractParser: () => ({
    recognizeText: jest.fn().mockResolvedValue({ text: "", confidence: 0 }),
  }),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockedScan = scanBarcodesFromImageBase64 as jest.Mock;
const mockedOcr = parseBoardingPass as jest.Mock;
const mockedConfig = getParserConfig as jest.Mock;
const mockedTextParser = getTextParserInstance as jest.Mock;
const mockedLookup = lookupFlightWithHistorical as jest.Mock;

/** Synthetic paper passes: day 008, issued in a year ending in 6. */
const pass = (route: string, flight: string, seat: string): string =>
  `M1DOE/JANEMS          EQ7XK2P ${route}UA ${flight} 008Y${seat}0006 15C>3180 K6008BUA 5016` +
  "8820310012901623589826560 UA LH 992002391797244     *30601    09         ";
const UA633 = pass("MCOORD", "0633", "024F");
const UA952 = pass("ORDMUC", "0952", "035A");

const scanOf = (...texts: string[]) => ({
  codes: texts.map((text, i) => ({
    text,
    format: "PDF417",
    box: { x: 1800, y: 100 + i * 1100, width: 300, height: 600 },
  })),
  imageDecoded: true,
  regionsTried: 2,
  attempts: 20,
  budgetExhausted: false,
});

const ocrOf = (text: string, booking: Record<string, unknown> = {}) => ({
  flights: [{ missing: [], ...booking }],
  provider: "tesseract",
  fallbackUsed: false,
  ocrText: text,
});

const llm = { checkAvailability: jest.fn(), parseEmail: jest.fn() };
const IMAGE = "BASE64IMAGE";
const USER = "user-1";

beforeEach(() => {
  jest.clearAllMocks();
  mockedScan.mockResolvedValue(scanOf());
  mockedOcr.mockResolvedValue(ocrOf(""));
  mockedConfig.mockResolvedValue({ textFallbacks: ["regex", "ollama"] });
  mockedTextParser.mockReturnValue(llm);
  llm.checkAvailability.mockResolvedValue({ available: true });
  llm.parseEmail.mockResolvedValue([]);
  mockedLookup.mockResolvedValue({ flights: [] });
});

const codes = (stages: readonly { stage: string; code: string }[]) =>
  stages.map((s) => `${s.stage}:${s.code}`);

describe("readBoardingPass — stage order barcode → parser → LLM", () => {
  it("runs the stages in order and does not ask the model when barcode and parser were enough", async () => {
    mockedScan.mockResolvedValue(scanOf(UA633));
    mockedOcr.mockResolvedValue(
      ocrOf("FRI 08 JAN 2016\nFlight Departs: 12:46 PM\nFlight Arrives: 2:49 PM")
    );

    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER });

    expect(codes(reading.stages)).toEqual([
      "barcode:BARCODE_FOUND",
      "ocr:OCR_OK",
      "parser:PARSER_OK",
      "lookup:LOOKUP_NOT_REQUESTED",
      "llm:LLM_NOT_NEEDED",
    ]);
    expect(llm.parseEmail).not.toHaveBeenCalled();
    expect(reading.merged).toMatchObject({
      flightNumber: "UA633",
      departureTime: "2016-01-08T12:46",
      arrivalTime: "2016-01-08T14:49",
    });
    // The printed card confirmed the year, so the date is no longer a guess.
    expect(reading.merged.inferredFields ?? []).not.toContain("departureTime");
  });

  it("reads two passes on one image as two flights, each from its own card", async () => {
    mockedScan.mockResolvedValue(scanOf(UA633, UA952));
    mockedOcr
      .mockResolvedValueOnce(ocrOf("08 JAN 2016 Flight Departs: 12:46 PM Flight Arrives: 2:49 PM"))
      .mockResolvedValueOnce(ocrOf("08 JAN 2016 Flight Departs: 5:50 PM Flight Arrives: 9:50 AM"));

    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER });

    expect(reading.legs.map((l) => [l.flightNumber, l.departureCode, l.arrivalCode])).toEqual([
      ["UA633", "MCO", "ORD"],
      ["UA952", "ORD", "MUC"],
    ]);
    expect(reading.legs[1]).toMatchObject({
      departureTime: "2016-01-08T17:50",
      arrivalTime: "2016-01-09T09:50",
    });
    expect(reading.stages[0]).toMatchObject({ code: "BARCODE_FOUND", count: 2 });
  });

  it("asks the model last, only for what barcode and parser left open", async () => {
    mockedScan.mockResolvedValue(scanOf(UA633));
    mockedOcr.mockResolvedValue(ocrOf("unreadable"));
    llm.parseEmail.mockResolvedValue([
      {
        flightNumber: "UA633",
        departureTime: "2026-01-08T12:46",
        arrivalTime: "2026-01-08T14:49",
        missing: [],
      },
    ]);

    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER });

    expect(codes(reading.stages).slice(-1)).toEqual(["llm:LLM_OK"]);
    expect(llm.parseEmail).toHaveBeenCalledWith(
      expect.any(String),
      "unreadable",
      undefined,
      undefined,
      expect.objectContaining({ documentKind: "boardingPass" })
    );
    expect(reading.merged.departureTime).toBe("2026-01-08T12:46");
    // The barcode's route is never overwritten by the model.
    expect(reading.merged.departureCode).toBe("MCO");
  });

  it("asks the flight lookup before the model when asked to enrich", async () => {
    mockedScan.mockResolvedValue(scanOf(UA633));
    mockedLookup.mockResolvedValue({
      flights: [
        {
          departure: { iata: "MCO", scheduledLocal: "2026-01-08T12:46" },
          arrival: { iata: "ORD", scheduledLocal: "2026-01-08T14:49" },
        },
      ],
    });

    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER, enrich: true });

    expect(codes(reading.stages).slice(-2)).toEqual(["lookup:LOOKUP_OK", "llm:LLM_NOT_NEEDED"]);
    expect(reading.enriched).toBe(true);
    expect(llm.parseEmail).not.toHaveBeenCalled();
  });
});

describe("readBoardingPass — per-stage error codes", () => {
  it("says no barcode was found, then what OCR and parser made of the card", async () => {
    mockedOcr.mockResolvedValue(
      ocrOf("LH117 MUC FRA", { flightNumber: "LH117", departureCode: "MUC", arrivalCode: "FRA" })
    );
    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER, allowLlm: false });
    expect(reading.stages[0]).toMatchObject({
      stage: "barcode",
      status: "failed",
      code: "BARCODE_NOT_FOUND",
    });
    expect(reading.stages[2]).toMatchObject({
      stage: "parser",
      code: "PARSER_PARTIAL",
      fields: ["departureDate", "departureClock"],
    });
  });

  it("names a barcode that is not a boarding pass", async () => {
    mockedScan.mockResolvedValue(scanOf("https://example.com/loyalty"));
    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER });
    expect(reading.stages[0].code).toBe("BARCODE_NOT_BOARDING_PASS");
  });

  it("says the flight was not found when the lookup has no match", async () => {
    mockedScan.mockResolvedValue(scanOf(UA633));
    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER, enrich: true });
    expect(reading.stages.find((s) => s.stage === "lookup")?.code).toBe("LOOKUP_NOT_FOUND");
  });

  it("says the model is not set up instead of skipping it silently", async () => {
    mockedScan.mockResolvedValue(scanOf(UA633));
    mockedOcr.mockResolvedValue(ocrOf("unreadable"));
    mockedConfig.mockResolvedValue({ textFallbacks: ["regex"] });
    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER });
    expect(reading.stages.at(-1)?.code).toBe("LLM_NOT_CONFIGURED");
  });

  it("says the model is unreachable", async () => {
    mockedScan.mockResolvedValue(scanOf(UA633));
    mockedOcr.mockResolvedValue(ocrOf("unreadable"));
    llm.checkAvailability.mockResolvedValue({ available: false, reason: "down" });
    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER });
    expect(reading.stages.at(-1)).toMatchObject({ status: "failed", code: "LLM_UNREACHABLE" });
  });

  it("says the model failed when it throws", async () => {
    mockedScan.mockResolvedValue(scanOf(UA633));
    mockedOcr.mockResolvedValue(ocrOf("unreadable"));
    llm.parseEmail.mockRejectedValue(new Error("timeout"));
    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER });
    expect(reading.stages.at(-1)?.code).toBe("LLM_FAILED");
    expect(reading.legs).toHaveLength(1);
  });

  it("carries the stages on the error when nothing at all could be read", async () => {
    mockedOcr.mockRejectedValue(new Error("tesseract exploded"));
    await expect(readBoardingPass({ imageBase64: IMAGE, userId: USER })).rejects.toMatchObject({
      name: "BoardingPassReadError",
      stages: [
        expect.objectContaining({ code: "BARCODE_NOT_FOUND" }),
        expect.objectContaining({ code: "OCR_FAILED" }),
      ],
    });
  });

  it("keeps two travellers on the same flight as two legs", async () => {
    const companion = UA633.replace("DOE/JANEMS  ", "DOE/JOHNMR  ").replace("024F", "024E");
    mockedScan.mockResolvedValue(scanOf(UA633, companion));
    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER, allowLlm: false });
    expect(reading.legs.map((l) => l.seat)).toEqual(["24F", "24E"]);
  });

  it("does not give a leg the model's answer for another carrier's flight", async () => {
    mockedScan.mockResolvedValue(scanOf(UA633));
    mockedOcr.mockResolvedValue(ocrOf("unreadable"));
    llm.parseEmail.mockResolvedValue([
      { flightNumber: "LH633", departureTime: "2026-01-08T07:00", missing: [] },
      { flightNumber: "LH634", missing: [] },
    ]);
    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER });
    expect(reading.merged.departureTime).toBe("2026-01-08T00:00");
    expect(reading.stages.at(-1)?.code).toBe("LLM_NOTHING");
  });

  it("reports an unreachable model when building or probing it throws", async () => {
    mockedScan.mockResolvedValue(scanOf(UA633));
    mockedOcr.mockResolvedValue(ocrOf("unreadable"));
    llm.checkAvailability.mockRejectedValue(new Error("ECONNREFUSED"));
    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER });
    expect(reading.stages.at(-1)?.code).toBe("LLM_UNREACHABLE");
    expect(reading.legs).toHaveLength(1);
  });
});
