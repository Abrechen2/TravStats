import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FerryLivePosition } from "../FerryLivePosition";
const mocks = vi.hoisted(() => ({ availability: vi.fn(), position: vi.fn(), t: (s: string) => s }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: "en" } }),
}));
vi.mock("../../../lib/api/ferry", () => ({
  ferryApi: { liveAvailability: mocks.availability, livePosition: mocks.position },
}));
beforeEach(() => {
  vi.clearAllMocks();
});
it("shows missing setup without trying a live lookup", async () => {
  mocks.availability.mockResolvedValue({ configured: false });
  render(<FerryLivePosition id="ferry" />);
  expect(await screen.findByText("ferry:live.notConfigured")).toBeVisible();
  expect(mocks.position).not.toHaveBeenCalled();
});
it("requires a nine-digit MMSI and labels a missing source timestamp honestly", async () => {
  mocks.availability.mockResolvedValue({ configured: true });
  mocks.position.mockResolvedValue({
    status: "ok",
    position: {
      mmsi: "211123456",
      vesselName: "Test ferry",
      lat: 54,
      lon: 10,
      speedKnots: 12,
      receivedAt: "2026-10-12T10:00:00Z",
      observedAt: null,
    },
  });
  render(<FerryLivePosition id="ferry" />);
  const input = await screen.findByLabelText("ferry:live.mmsi");
  const button = screen.getByRole("button", { name: "ferry:live.read" });
  expect(button).toBeDisabled();
  fireEvent.change(input, { target: { value: "211123456" } });
  fireEvent.click(button);
  expect(await screen.findByText("ferry:live.ageUnknown")).toBeVisible();
  expect(mocks.position).toHaveBeenCalledWith("ferry", "211123456");
});
it("reads only the crossing's vessel once one is bound", async () => {
  // The server refuses another MMSI for a bound crossing; the field says so
  // instead of letting a typed number fail as "service unavailable".
  mocks.availability.mockResolvedValue({ configured: true });
  render(<FerryLivePosition id="ferry" boundMmsi="211123456" />);
  const input = await screen.findByLabelText("ferry:live.mmsi");
  expect(input).toHaveValue("211123456");
  expect(input).toHaveAttribute("readonly");
  expect(screen.getByText("ferry:live.bound")).toBeVisible();
});
