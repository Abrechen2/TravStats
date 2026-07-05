import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseStopsEditor } from "../../../components/Cruise/CruiseStopsEditor";
import { portsApi } from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
  portsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" }, ready: true }),
}));

describe("CruiseStopsEditor", () => {
  it("adds a stop with auto-incremented dayNumber", async () => {
    const onChange = vi.fn();
    render(<CruiseStopsEditor stops={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /stops\.add/ }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ dayNumber: 1, isAtSea: false, portId: null }),
    ]);
  });

  it("shows a date input for every stop (incl. sea days) and emits a UTC-midnight ISO (#132)", async () => {
    const stops = [{ portId: null, dayNumber: 1, isAtSea: true }];
    const onChange = vi.fn();
    render(<CruiseStopsEditor stops={stops} onChange={onChange} />);
    const dateInput = screen.getByLabelText("stops.date");
    expect(dateInput).toBeInTheDocument();
    await userEvent.type(dateInput, "2027-10-08");
    const calls = onChange.mock.calls;
    const emitted = calls[calls.length - 1][0] as Array<{ date: string | null }>;
    expect(emitted[0].date).toBe("2027-10-08T00:00:00.000Z");
  });

  it("renders an existing stop date in the date input", () => {
    const stops = [{ portId: null, dayNumber: 1, isAtSea: true, date: "2027-10-08T00:00:00.000Z" }];
    render(<CruiseStopsEditor stops={stops} onChange={vi.fn()} />);
    expect(screen.getByLabelText("stops.date")).toHaveValue("2027-10-08");
  });

  it("removes a stop and renumbers subsequent days", async () => {
    const stops = [
      { portId: 1, dayNumber: 1, isAtSea: false },
      { portId: 2, dayNumber: 2, isAtSea: false },
      { portId: 3, dayNumber: 3, isAtSea: false },
    ];
    const onChange = vi.fn();
    render(<CruiseStopsEditor stops={stops} onChange={onChange} />);
    // Remove the first row — find all remove buttons by accessible name and click the first.
    const removeBtns = screen.getAllByRole("button", { name: /remove|×/i });
    await userEvent.click(removeBtns[0]);
    const emitted = onChange.mock.calls[0][0] as Array<{ dayNumber: number }>;
    expect(emitted.length).toBe(2);
    expect(emitted[0].dayNumber).toBe(1);
    expect(emitted[1].dayNumber).toBe(2);
  });

  it("shows a 🔶 unresolved banner for an unresolved stop and clears the name on resolve", async () => {
    vi.mocked(portsApi.search).mockResolvedValue([
      {
        id: 42,
        name: "Taranto",
        city: "Taranto",
        country: "Italy",
        unlocode: "ITTAR",
        lat: 40.4738,
        lon: 17.2296,
        timezone: "Europe/Rome",
        region: "Europe",
        isUserAdded: false,
      },
    ]);
    const onChange = vi.fn();
    render(
      <CruiseStopsEditor
        stops={[{ portId: null, dayNumber: 1, isAtSea: false, unresolvedPortName: "Taranto" }]}
        onChange={onChange}
      />
    );
    // The unresolved name is visible.
    expect(screen.getByText(/Taranto/)).toBeInTheDocument();

    // Resolving via the PortPicker sets portId and clears unresolvedPortName.
    await userEvent.type(screen.getByRole("combobox"), "Taranto");
    await waitFor(() => expect(portsApi.search).toHaveBeenCalled(), { timeout: 2000 });
    await userEvent.click(await screen.findByRole("button", { name: /Taranto/ }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ portId: 42, unresolvedPortName: null }),
    ]);
  });

  it("clears the unresolved port name when toggling a stop to at-sea", async () => {
    const onChange = vi.fn();
    render(
      <CruiseStopsEditor
        stops={[{ portId: null, dayNumber: 1, isAtSea: false, unresolvedPortName: "Taranto" }]}
        onChange={onChange}
      />
    );
    await userEvent.click(screen.getByRole("checkbox"));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ isAtSea: true, unresolvedPortName: null }),
    ]);
  });
});
