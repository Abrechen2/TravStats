import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DomainImportPanel from "../DomainImportPanel";
import { useTripImportAdapter } from "../adapters/tripAdapter";

/**
 * Browser acceptance 2026-09-26: on /trips, "Leer anlegen und von Hand
 * füllen" opened the trip form UNDER the chooser. The chooser is a portal
 * Modal, the trip form renders in place, so the chooser stayed on top, and its
 * × closed both. This drives the real click path through the real adapter and
 * the real TripModal.
 */

const mocks = vi.hoisted(() => ({ create: vi.fn(), detect: vi.fn() }));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "de", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));
vi.mock("../../CompanionPicker", () => ({ default: () => null }));
vi.mock("@/hooks/useTagSuggestions", () => ({ useTagSuggestions: () => [] }));
vi.mock("@/hooks/useTripEntrySuggestions", () => ({
  useTripEntrySuggestions: () => ({ origins: [], destinations: [] }),
}));
vi.mock("../../../lib/api", () => ({
  tripsApi: { create: mocks.create, detect: mocks.detect },
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock("../EmailImportTab", () => ({ default: () => null }));

function Host({ onClose }: { onClose: () => void }): JSX.Element {
  const adapter = useTripImportAdapter(vi.fn());
  return <DomainImportPanel open onClose={onClose} onItemsCreated={vi.fn()} adapter={adapter} />;
}

describe("Trips — 'start empty' from the add chooser", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.detect.mockReset();
  });

  it("closes the chooser and leaves a usable trip form", async () => {
    const user = userEvent.setup();
    render(<Host onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "import:trip.panelTitle" })).toBeTruthy();
    await user.click(screen.getByText("import:trip.manual"));

    // The chooser is gone — nothing sits above the form any more.
    expect(screen.queryByRole("dialog", { name: "import:trip.panelTitle" })).toBeNull();
    expect(screen.queryByText("import:trip.manual")).toBeNull();

    // The form takes input.
    const name = screen.getByPlaceholderText("trips:modal.namePlaceholder");
    await user.type(name, "Lissabon");
    expect((name as HTMLInputElement).value).toBe("Lissabon");
  });

  it("cancelling the form ends the flow instead of reviving the chooser", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);

    await user.click(screen.getByText("import:trip.manual"));
    await user.click(screen.getByText("trips:modal.cancel"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
