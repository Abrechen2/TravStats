import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseImportPreviewModal } from "../../../components/Cruise/CruiseImportPreviewModal";
import { cruiseApi } from "../../../lib/api/cruise";
import type { ParsedCruiseEntry } from "../../../lib/api/parse";
import type { Cruise } from "../../../types";

// `t` echoes the key so pill/checkbox text assertions read the raw i18n key,
// matching the convention used by CruiseEditModal's status test.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
    ready: true,
  }),
}));

// The import editor also renders ShipPicker/PortPicker, which reach into
// lib/api for their own search calls — stub those out so the modal can
// render without hitting the network.
vi.mock("../../../lib/api", () => ({
  shipsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  portsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  airportsApi: { search: vi.fn().mockResolvedValue([]), getByCode: vi.fn() },
  setupApi: { getAirportSeedingStatus: vi.fn().mockResolvedValue({ status: "idle" }) },
}));

vi.mock("../../../lib/api/cruise", () => ({
  cruiseApi: { create: vi.fn() },
}));

vi.mock("../../../lib/api/flights", () => ({
  flightsApi: { create: vi.fn() },
}));

vi.mock("../../../lib/api/trips", () => ({
  tripsApi: { create: vi.fn(), assignFlights: vi.fn() },
}));

vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...args: unknown[]) => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = { display: { language: "en", timezone: "UTC" } };
      return typeof selector === "function" ? selector(state) : state;
    },
    { getState: () => ({ display: { language: "en", timezone: "UTC" } }) }
  ),
}));

const baseEntry: ParsedCruiseEntry = {
  input: {
    cruiseLine: "AIDA",
    routeName: "Mediterranean",
    startDate: "2026-06-15T12:00:00.000Z",
    endDate: "2026-06-22T12:00:00.000Z",
    status: "scheduled",
    stops: [],
  },
  shipMatched: false,
  unmatchedPorts: [],
};

describe("CruiseImportPreviewModal — status (#status-from-dates)", () => {
  beforeEach(() => {
    vi.mocked(cruiseApi.create).mockClear();
  });

  it("has no status select — status is a read-only pill plus a Storniert checkbox", () => {
    const { container } = render(
      <CruiseImportPreviewModal entries={[baseEntry]} onCancel={vi.fn()} onSaved={vi.fn()} />
    );

    // cabinType + currency selects remain — only the status select is gone.
    const selects = Array.from(container.querySelectorAll("select"));
    expect(selects.length).toBe(2);
    for (const select of selects) {
      expect(select.textContent).not.toContain("status.");
    }

    expect(container.textContent).toContain("status.scheduled");
    expect(screen.getByText("status.cancelledCheckbox")).toBeInTheDocument();
    const checkbox = screen
      .getByText("status.cancelledCheckbox")
      .closest("label")
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(false);
  });

  it('checking the Storniert checkbox sends status "cancelled" on save', async () => {
    vi.mocked(cruiseApi.create).mockResolvedValue({ id: "c1" } as unknown as Cruise);

    render(<CruiseImportPreviewModal entries={[baseEntry]} onCancel={vi.fn()} onSaved={vi.fn()} />);

    const checkbox = screen
      .getByText("status.cancelledCheckbox")
      .closest("label")
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await userEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(screen.getByText("status.cancelled")).toBeInTheDocument();

    await userEvent.click(screen.getByText("cruise:import.save"));

    await waitFor(() => expect(cruiseApi.create).toHaveBeenCalled());
    const payload = vi.mocked(cruiseApi.create).mock.calls[0][0];
    expect(payload.status).toBe("cancelled");
  });

  it("unchecking the Storniert checkbox reverts to \"scheduled\" (backend re-derives)", async () => {
    vi.mocked(cruiseApi.create).mockResolvedValue({ id: "c1" } as unknown as Cruise);
    const cancelledEntry: ParsedCruiseEntry = {
      ...baseEntry,
      input: { ...baseEntry.input, status: "cancelled" },
    };

    render(
      <CruiseImportPreviewModal entries={[cancelledEntry]} onCancel={vi.fn()} onSaved={vi.fn()} />
    );

    const checkbox = screen
      .getByText("status.cancelledCheckbox")
      .closest("label")
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    await userEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);

    await userEvent.click(screen.getByText("cruise:import.save"));

    await waitFor(() => expect(cruiseApi.create).toHaveBeenCalled());
    const payload = vi.mocked(cruiseApi.create).mock.calls[0][0];
    expect(payload.status).toBe("scheduled");
  });
});
