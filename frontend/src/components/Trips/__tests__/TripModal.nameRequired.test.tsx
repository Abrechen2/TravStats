import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import TripModal from "../TripModal";
import type { Trip } from "../../../types";

/**
 * A trip name of only spaces left the save button greyed out with no word of
 * why, and the server accepted "   " from anything else that sent it. The
 * server refuses it now (trim, then at least one character); the form says
 * WHICH field is missing instead of a dead button.
 */

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

const trip: Trip = {
  id: "t1",
  userId: "u1",
  name: "Sommer",
  color: "#818cf8",
  tags: [],
  companions: [],
  createdAt: "2025-01-01T00:00:00.000Z",
} as unknown as Trip;

function nameInput(): HTMLInputElement {
  return screen.getByPlaceholderText("trips:modal.namePlaceholder") as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByText("trips:modal.save").closest("button") as HTMLButtonElement;
}

describe("TripModal — a trip needs a name", () => {
  beforeEach(() => {
    mocks.update.mockReset().mockResolvedValue(trip);
    mocks.create.mockReset().mockResolvedValue(trip);
  });

  it("names the missing field on a new trip and sends nothing", () => {
    render(<TripModal trip={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(nameInput(), { target: { value: "   " } });
    fireEvent.click(saveButton());

    expect(screen.getByRole("alert")).toHaveTextContent("trips:modal.nameRequired");
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses to blank the name of an existing trip", () => {
    render(<TripModal trip={trip} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(nameInput(), { target: { value: " \t " } });
    fireEvent.click(saveButton());

    expect(screen.getByRole("alert")).toHaveTextContent("trips:modal.nameRequired");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("drops the message once a name is typed, and saves it trimmed", async () => {
    render(<TripModal trip={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(nameInput(), { target: { value: "  " } });
    fireEvent.click(saveButton());
    fireEvent.change(nameInput(), { target: { value: "  Lissabon " } });

    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ name: "Lissabon" });
  });
});
