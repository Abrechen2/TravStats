import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TripModal from "../../../components/Trips/TripModal";
import { tripsApi, companionsApi } from "../../../lib/api";
import type { Trip } from "../../../types";

vi.mock("../../../lib/api", () => ({
  tripsApi: { create: vi.fn(), update: vi.fn(), uploadCover: vi.fn() },
  companionsApi: { list: vi.fn() },
}));

vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

const existingTrip = {
  id: "t1",
  userId: "u1",
  name: "Existing trip",
  description: null,
  color: "#4a90d9",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  startDate: null,
  endDate: null,
  status: "planned",
  category: null,
  tags: [],
  companions: [],
  notes: null,
  summary: null,
  originLabel: null,
  destinationLabel: null,
  coverImageUrl: null,
  icon: null,
  countries: [],
} as unknown as Trip;

describe("TripModal", () => {
  beforeEach(() => {
    vi.mocked(companionsApi.list).mockReset().mockResolvedValue([]);
  });

  // #status-from-dates: trip status is now derived from segment dates
  // (deriveTripStatus in shared/statusDerivation.ts) — a manual select let the
  // UI set a value the backend would immediately overwrite on the next sweep.
  it("has no status select — trips derive their status from dates (#status-from-dates)", () => {
    const { container } = render(<TripModal trip={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    // Only the category select remains; the status select is gone.
    expect(container.querySelectorAll("select").length).toBe(1);
    expect(screen.queryByText("trips:modal.statusLabel")).not.toBeInTheDocument();
  });

  it("create payload never includes a status field", async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: "t1" } as unknown as Trip);
    render(<TripModal trip={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.type(
      screen.getByPlaceholderText("trips:modal.namePlaceholder"),
      "Japan trip"
    );
    await userEvent.click(screen.getByText("trips:modal.save"));

    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled());
    const payload = vi.mocked(tripsApi.create).mock.calls[0][0];
    expect(payload).not.toHaveProperty("status");
  });

  it("update payload never includes a status field", async () => {
    vi.mocked(tripsApi.update).mockResolvedValue(existingTrip);
    render(<TripModal trip={existingTrip} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByText("trips:modal.save"));

    await waitFor(() => expect(tripsApi.update).toHaveBeenCalled());
    const payload = vi.mocked(tripsApi.update).mock.calls[0][1];
    expect(payload).not.toHaveProperty("status");
  });

  // Task 12 — the comma-separated companions text input on the "people" tab
  // is replaced by the shared CompanionPicker.
  it("renders existing companions as removable chips instead of a CSV text field", async () => {
    const tripWithCompanions: Trip = { ...existingTrip, companions: ["Anna", "Jonas"] };
    render(<TripModal trip={tripWithCompanions} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: /trips:modalTabs\.people/ }));

    expect(screen.getByTestId("companion-remove-Anna")).toBeInTheDocument();
    expect(screen.getByTestId("companion-remove-Jonas")).toBeInTheDocument();
  });

  it("submits companions as a string[] built from the picker chips", async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: "t1" } as unknown as Trip);
    render(<TripModal trip={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.type(
      screen.getByPlaceholderText("trips:modal.namePlaceholder"),
      "Japan trip"
    );
    await userEvent.click(screen.getByRole("tab", { name: /trips:modalTabs\.people/ }));
    await userEvent.type(
      screen.getByRole("combobox", { name: "picker.label" }),
      "Marie{Enter}"
    );
    await userEvent.click(screen.getByText("trips:modal.save"));

    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled());
    const calls = vi.mocked(tripsApi.create).mock.calls;
    const payload = calls[calls.length - 1][0];
    expect(payload.companions).toEqual(["Marie"]);
  });
});
