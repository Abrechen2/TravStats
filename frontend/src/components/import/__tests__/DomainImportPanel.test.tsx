import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DomainImportPanel from "../DomainImportPanel";
import type { DomainImportAdapter } from "../types";

// Provide readable labels for the import namespace used by the panel.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "import:route.document.title": "Booking mail or PDF",
        "import:route.document.description": "We read it, you check it.",
        "import:route.manual": "Enter by hand",
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

// Stub the lazy-loaded drop zone so we don't drag in the parse API.
vi.mock("../EmailImportTab", () => ({
  default: () => <div data-testid="email-tab-content">EmailTab</div>,
}));

const renderManualSpy = vi.fn();
const renderReviewSpy = vi.fn();
const routeSelectSpy = vi.fn();

const adapter: DomainImportAdapter = {
  domain: "cruise",
  panelTitle: "Test Import",
  panelHint: "Hint text",
  acceptedEmailExtensions: [".eml", ".msg"],
  routes: [
    {
      id: "catalogue",
      icon: "🚢",
      title: "Pick a ship",
      description: "From the catalogue.",
      actionLabel: "Pick",
      onSelect: routeSelectSpy,
    },
    {
      id: "not-yet",
      icon: "🧪",
      title: "Built but hidden",
      description: "Waiting for its domain.",
      hidden: true,
    },
  ],
  renderManual: (props) => {
    renderManualSpy(props);
    return <div data-testid="manual-modal">Manual Modal</div>;
  },
  renderReviewModal: (props) => {
    renderReviewSpy(props);
    return <div data-testid="review-modal">Review Modal</div>;
  },
};

function renderPanel(over: Partial<DomainImportAdapter> = {}): void {
  render(
    <DomainImportPanel
      open
      onClose={vi.fn()}
      onItemsCreated={vi.fn()}
      adapter={{ ...adapter, ...over }}
    />
  );
}

describe("DomainImportPanel", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <DomainImportPanel open={false} onClose={vi.fn()} onItemsCreated={vi.fn()} adapter={adapter} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("opens straight onto the drop zone — no tab to pick first", async () => {
    renderPanel();
    expect(screen.getByText("Test Import")).toBeTruthy();
    expect(screen.getByText("Hint text")).toBeTruthy();
    expect(screen.getByText("Booking mail or PDF")).toBeTruthy();
    // The drop zone is the first route, not something behind a tab.
    expect(screen.queryByRole("tab")).toBeNull();
    expect(await screen.findByTestId("email-tab-content")).toBeTruthy();
  });

  it("renders the adapter's own routes", () => {
    renderPanel();
    expect(screen.getByText("Pick a ship")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect(routeSelectSpy).toHaveBeenCalledTimes(1);
  });

  // A route that is built but not offered yet must not reach the screen —
  // otherwise "hidden" would be a comment rather than a guarantee.
  it("never renders a hidden route", () => {
    renderPanel();
    expect(screen.queryByText("Built but hidden")).toBeNull();
  });

  // A domain whose parser does not exist yet must not show a drop zone that
  // promises a reading it cannot deliver.
  it("omits the drop zone when the domain has no document import", () => {
    renderPanel({ supportsDocumentImport: false });
    expect(screen.queryByText("Booking mail or PDF")).toBeNull();
    expect(screen.getByText("Pick a ship")).toBeTruthy();
  });

  it("the manual footer triggers the adapter's renderManual slot", () => {
    renderPanel();
    renderManualSpy.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Enter by hand" }));
    expect(renderManualSpy).toHaveBeenCalled();
    expect(screen.getByTestId("manual-modal")).toBeTruthy();
  });

  it("calls onClose when the close (×) button is clicked", () => {
    const onClose = vi.fn();
    render(
      <DomainImportPanel open onClose={onClose} onItemsCreated={vi.fn()} adapter={adapter} />
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
