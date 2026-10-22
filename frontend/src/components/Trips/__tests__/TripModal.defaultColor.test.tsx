import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import TripModal from "../TripModal";
import type { Trip } from "../../../types";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";
import { TRIP_COLORS } from "../../../lib/tripColors";

const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn() }));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../CompanionPicker", () => ({ default: () => null }));
vi.mock("@/hooks/useTagSuggestions", () => ({ useTagSuggestions: () => [] }));
vi.mock("@/hooks/useTripEntrySuggestions", () => ({
  useTripEntrySuggestions: () => ({ origins: [], destinations: [] }),
}));
vi.mock("../../../lib/api", () => ({
  tripsApi: { update: mocks.update, create: mocks.create },
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

const saved = { id: "t1", name: "Neu", color: TRIP_COLORS[0], tags: [], companions: [] };

/**
 * "Reisefarbe für neue Reisen" (forgejo#321): the "new trip" form starts with
 * the account's chosen colour; while it is automatic the form sends none and
 * the server rotates through the palette, as for every other new trip.
 */
describe("TripModal — the colour a new trip starts with", () => {
  beforeEach(() => {
    mocks.create.mockReset().mockResolvedValue(saved as unknown as Trip);
    mocks.update.mockReset().mockResolvedValue(saved as unknown as Trip);
  });

  const createWithName = async (): Promise<void> => {
    fireEvent.change(screen.getByPlaceholderText("trips:modal.namePlaceholder"), {
      target: { value: "Neu" },
    });
    fireEvent.click(screen.getByText("trips:modal.save").closest("button") as HTMLElement);
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
  };

  it("sends the chosen colour", async () => {
    useSuggestionSwitchesStore.setState({ tripDefaultColor: TRIP_COLORS[6] });
    render(<TripModal trip={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await createWithName();
    expect(mocks.create.mock.calls[0][0].color).toBe(TRIP_COLORS[6]);
  });

  it("sends no colour while it is automatic, so the server rotates", async () => {
    useSuggestionSwitchesStore.setState({ tripDefaultColor: null });
    render(<TripModal trip={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await createWithName();
    expect(mocks.create.mock.calls[0][0].color).toBeUndefined();
  });
});
