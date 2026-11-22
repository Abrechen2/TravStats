import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import BoardingPassScanner from "../../BoardingPassScanner";

const mocks = vi.hoisted(() => ({ parseBoardingpass: vi.fn(), extract: vi.fn() }));

vi.mock("../../../lib/api", () => ({ parseApi: { parseBoardingpass: mocks.parseBoardingpass } }));
vi.mock("../../../lib/barcodeExtractor", () => ({ extractBarcodeFromImage: mocks.extract }));
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

const upload = () => {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "pass.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByTestId("boarding-pass-file"), { target: { files: [file] } });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.extract.mockResolvedValue(null);
});

/**
 * Owner report 2026-11-22: a scan showed "Ollama Vision analysiert…" and then
 * a vague error. Every stage now shows what it did, in the reader's language.
 */
describe("BoardingPassScanner — stages and per-stage messages", () => {
  it("shows each server stage and hands on every pass read off the photo", async () => {
    const onScanSuccess = vi.fn();
    const flights = [
      { flightNumber: "UA633", departureCode: "MCO", arrivalCode: "ORD", missing: [] },
      { flightNumber: "UA952", departureCode: "ORD", arrivalCode: "MUC", missing: [] },
    ];
    mocks.parseBoardingpass.mockResolvedValue({
      flight: flights[0],
      flights,
      stages: [
        { stage: "barcode", status: "ok", code: "BARCODE_FOUND", count: 2 },
        { stage: "ocr", status: "ok", code: "OCR_OK", count: 2 },
        { stage: "parser", status: "partial", code: "PARSER_PARTIAL", fields: ["departureClock"] },
        { stage: "lookup", status: "failed", code: "LOOKUP_NOT_FOUND" },
        { stage: "llm", status: "skipped", code: "LLM_NOT_CONFIGURED" },
      ],
    });
    render(<BoardingPassScanner onScanSuccess={onScanSuccess} onClose={vi.fn()} />);

    upload();

    expect(await screen.findByText("Barcode erkannt – 2 Bordkarte(n)")).toBeInTheDocument();
    expect(screen.getByText("Teilweise erkannt – es fehlt: Abflugzeit")).toBeInTheDocument();
    expect(screen.getByText(/Flug wurde in den Flugdaten nicht gefunden/)).toBeInTheDocument();
    expect(screen.getByText(/KI-Parser ist nicht eingerichtet/)).toBeInTheDocument();
    // The server step asks for the lookup now — the old scanner passed false.
    expect(mocks.parseBoardingpass).toHaveBeenCalledWith(expect.any(String), true);

    fireEvent.click(screen.getByRole("button", { name: "2 Flüge prüfen" }));
    expect(onScanSuccess).toHaveBeenCalledWith(flights);
  });

  it("names the failed stage instead of only a generic error", async () => {
    mocks.parseBoardingpass.mockRejectedValue({
      response: {
        status: 422,
        data: {
          code: "NO_FLIGHT_DATA",
          stages: [
            { stage: "barcode", status: "failed", code: "BARCODE_NOT_FOUND" },
            { stage: "ocr", status: "ok", code: "OCR_OK", count: 1 },
            { stage: "parser", status: "failed", code: "PARSER_NOTHING" },
          ],
        },
      },
    });
    render(<BoardingPassScanner onScanSuccess={vi.fn()} onClose={vi.fn()} />);

    upload();

    expect(await screen.findByText(/Kein Barcode erkannt – Foto schärfer/)).toBeInTheDocument();
    expect(screen.getByText("Im Text wurden keine Flugdaten gefunden.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/keine Flugdaten erkannt/);
  });

  it("offers the browser's own barcode reading when the server fails, never silently", async () => {
    const onScanSuccess = vi.fn();
    mocks.extract.mockResolvedValue("M1DOE/JANE            EQ7XK2P MUCFRALH 0117 242C008C0077 100");
    mocks.parseBoardingpass.mockRejectedValue({ response: { status: 500, data: {} } });
    render(<BoardingPassScanner onScanSuccess={onScanSuccess} onClose={vi.fn()} />);

    upload();

    const button = await screen.findByRole("button", { name: "Mit den Barcode-Daten weiter" });
    expect(screen.getByText("Der Server konnte die Bordkarte nicht lesen.")).toBeInTheDocument();
    expect(onScanSuccess).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(onScanSuccess).toHaveBeenCalledTimes(1));
    expect(onScanSuccess.mock.calls[0][0][0]).toMatchObject({
      departureCode: "MUC",
      arrivalCode: "FRA",
    });
  });
});
