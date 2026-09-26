import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Suspense } from "react";

/**
 * Acceptance D1 (2026-09-26): a Lufthansa booking mail dropped into the rail
 * import came back as two "train rides" MUC→FRA and FRA→MUC with the stations
 * "Mücka" and "Frant" — nothing said it was a flight. The server now answers
 * such a document with `domainMismatch`; the dialog says what the document is
 * and hands the SAME document to the import it belongs to.
 */

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../store/toastStore", () => ({ useToastStore: () => vi.fn() }));
vi.mock("../../../lib/api/parse", () => ({
  parseApi: { parseEmailFile: vi.fn(), parseEmail: vi.fn(), parsePdf: vi.fn() },
}));
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    api: Object.assign(Object.create(Object.getPrototypeOf(actual.api)), actual.api, {
      get: vi.fn().mockResolvedValue({ data: { hasLlm: false } }),
    }),
  };
});

import DomainImportPanel from "../DomainImportPanel";
import EmailImportTab from "../EmailImportTab";
import { parseApi } from "../../../lib/api/parse";
import type { DomainImportAdapter } from "../types";

const FLIGHT_MAIL = new File(["x"], "Buchungsdetails _ Abflug_ 06 Mai 2024 _ MUC-FRA_.msg", {
  type: "application/vnd.ms-outlook",
});

const reviewSpy = vi.fn();
const railAdapter: DomainImportAdapter = {
  domain: "rail",
  panelTitle: "Fahrt hinzufügen",
  panelHint: "hint",
  acceptedEmailExtensions: [".eml", ".msg", ".txt"],
  renderManual: () => null,
  renderReviewModal: (props) => {
    reviewSpy(props);
    return <div data-testid="review">review</div>;
  },
};

function dropFile(container: HTMLElement, file: File): void {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("a flight mail dropped into the rail import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseApi.parseEmailFile).mockResolvedValue({
      domain: "rail",
      bookings: [],
      parserUsed: "none",
      ollamaAvailable: true,
      fallbackCode: "otherDomain",
      domainMismatch: { detected: "flight", confidence: 1 },
    } as never);
  });

  it("says it is a flight booking and opens the flight import with the same file", async () => {
    const onClose = vi.fn();
    const onOpenOtherImport = vi.fn();
    const { baseElement } = render(
      <DomainImportPanel
        open
        onClose={onClose}
        onItemsCreated={vi.fn()}
        adapter={railAdapter}
        onOpenOtherImport={onOpenOtherImport}
        openableDomains={["flight", "rail"]}
      />
    );
    await waitFor(() => expect(baseElement.querySelector('input[type="file"]')).not.toBeNull());
    dropFile(baseElement, FLIGHT_MAIL);

    expect(await screen.findByTestId("wrong-dialog-notice")).toHaveTextContent(
      "import:wrongDialog.flight"
    );
    // Nothing is offered for review — no "journeys", no "Mücka".
    expect(reviewSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "import:wrongDialog.open.flight" }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenOtherImport).toHaveBeenCalledWith("flight", { kind: "file", file: FLIGHT_MAIL });
  });

  it("offers no jump to an import the host cannot open, but still says what it is", async () => {
    const { baseElement } = render(
      <DomainImportPanel
        open
        onClose={vi.fn()}
        onItemsCreated={vi.fn()}
        adapter={railAdapter}
        onOpenOtherImport={vi.fn()}
        openableDomains={["rail"]}
      />
    );
    await waitFor(() => expect(baseElement.querySelector('input[type="file"]')).not.toBeNull());
    dropFile(baseElement, FLIGHT_MAIL);
    expect(await screen.findByTestId("wrong-dialog-notice")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "import:wrongDialog.open.flight" })).toBeNull();
  });
});

describe("the import a document was handed to", () => {
  it("reads the handed-over file once, without the user dropping it again", async () => {
    vi.mocked(parseApi.parseEmailFile).mockResolvedValue({ flights: [] } as never);
    const onEmailResult = vi.fn();
    render(
      <Suspense fallback={null}>
        <EmailImportTab
          domain="flight"
          acceptedExtensions={[".eml", ".msg", ".txt", ".pdf"]}
          onEmailResult={onEmailResult}
          onError={vi.fn()}
          initialDocument={{ kind: "file", file: FLIGHT_MAIL }}
        />
      </Suspense>
    );
    await waitFor(() => expect(onEmailResult).toHaveBeenCalledTimes(1));
    expect(parseApi.parseEmailFile).toHaveBeenCalledWith(FLIGHT_MAIL, "flight");
  });
});
