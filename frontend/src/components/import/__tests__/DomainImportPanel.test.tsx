import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DomainImportPanel from "../DomainImportPanel";
import type { DomainImportAdapter } from "../types";

// Provide readable labels for the import namespace used by the panel.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "import:tabs.email": "Email",
        "import:tabs.pdf": "PDF",
        "import:tabs.manual": "Manual",
        "import:tabs.manualHint": "Opening entry form …",
        "common:buttons.close": "Close",
        "common:loading.default": "Loading …",
      };
      return labels[key] ?? key;
    },
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

vi.mock("../../../store/toastStore", () => ({
  useToastStore: () => vi.fn(),
}));

// Stub the lazy-loaded tab components so we don't drag in the parse API.
vi.mock("../EmailImportTab", () => ({
  default: () => <div data-testid="email-tab-content">EmailTab</div>,
}));
vi.mock("../PdfImportTab", () => ({
  default: () => <div data-testid="pdf-tab-content">PdfTab</div>,
}));

const renderManualSpy = vi.fn();
const renderReviewSpy = vi.fn();

const adapter: DomainImportAdapter = {
  domain: "cruise",
  panelTitle: "Test Import",
  panelHint: "Hint text",
  acceptedEmailExtensions: [".eml", ".msg"],
  renderManual: (props) => {
    renderManualSpy(props);
    return <div data-testid="manual-modal">Manual Modal</div>;
  },
  renderReviewModal: (props) => {
    renderReviewSpy(props);
    return <div data-testid="review-modal">Review Modal</div>;
  },
};

describe("DomainImportPanel", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <DomainImportPanel
        open={false}
        onClose={vi.fn()}
        onItemsCreated={vi.fn()}
        adapter={adapter}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders header + three tabs when open", async () => {
    render(<DomainImportPanel open onClose={vi.fn()} onItemsCreated={vi.fn()} adapter={adapter} />);
    expect(screen.getByText("Test Import")).toBeTruthy();
    expect(screen.getByText("Hint text")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Email" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "PDF" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Manual" })).toBeTruthy();
    // Email tab is the default — content lives behind Suspense, so wait for it.
    expect(await screen.findByTestId("email-tab-content")).toBeTruthy();
  });

  it("switches to PDF tab on click", async () => {
    render(<DomainImportPanel open onClose={vi.fn()} onItemsCreated={vi.fn()} adapter={adapter} />);
    fireEvent.click(screen.getByRole("tab", { name: "PDF" }));
    expect(await screen.findByTestId("pdf-tab-content")).toBeTruthy();
  });

  it("clicking Manual triggers the adapter's renderManual slot", () => {
    render(<DomainImportPanel open onClose={vi.fn()} onItemsCreated={vi.fn()} adapter={adapter} />);
    renderManualSpy.mockClear();
    fireEvent.click(screen.getByRole("tab", { name: "Manual" }));
    expect(renderManualSpy).toHaveBeenCalled();
    expect(screen.getByTestId("manual-modal")).toBeTruthy();
  });

  it("calls onClose when the close (×) button is clicked", () => {
    const onClose = vi.fn();
    render(<DomainImportPanel open onClose={onClose} onItemsCreated={vi.fn()} adapter={adapter} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
