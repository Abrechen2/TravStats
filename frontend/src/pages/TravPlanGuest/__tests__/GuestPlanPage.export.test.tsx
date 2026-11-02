import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import GuestPlanPage from "../GuestPlanPage";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  exportTrip: vi.fn(),
  downloadBlob: vi.fn(),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../lib/api/travplanGuests", () => ({
  travplanGuestsApi: { session: mocks.session, exportTrip: mocks.exportTrip },
}));
vi.mock("../../../lib/export", () => ({ downloadBlob: mocks.downloadBlob }));
vi.mock("../../TravPlan/PlanContent", () => ({
  default: () => <div>plan</div>,
  PLAN_SECTIONS: ["overview"],
}));

const TRIP = "11111111-1111-4111-8111-111111111111";
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/guest/plan/${TRIP}`]}>
      <Routes>
        <Route path="/guest/plan/:tripId" element={<GuestPlanPage />} />
      </Routes>
    </MemoryRouter>
  );

describe("GuestPlanPage — the trip as a file (spec §6.6, §6.7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({
      planId: "p1",
      tripId: TRIP,
      planName: "Plan",
      memberId: "m1",
      displayName: "Anna",
      origin: "https://guest.example",
      credential: "session",
    });
  });

  it("saves the host's .travstats file under the name the host gave it", async () => {
    const blob = new Blob(["zip"]);
    mocks.exportTrip.mockResolvedValue({ blob, filename: "madeira-2027-03-10.travstats" });
    renderPage();
    await userEvent.click(await screen.findByText("guests.export"));
    await waitFor(() =>
      expect(mocks.downloadBlob).toHaveBeenCalledWith(blob, "madeira-2027-03-10.travstats")
    );
  });

  it("says why when the file cannot be made, and saves nothing", async () => {
    mocks.exportTrip.mockRejectedValue(new Error("down"));
    renderPage();
    await userEvent.click(await screen.findByText("guests.export"));
    expect(await screen.findByText(/guests.exportFailed|errors\./)).toBeInTheDocument();
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });
});
