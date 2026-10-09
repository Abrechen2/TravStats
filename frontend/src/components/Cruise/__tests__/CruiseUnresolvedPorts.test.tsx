import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseUnresolvedPorts } from "../CruiseUnresolvedPorts";
import { resolveStops, unresolvedGroups } from "../cruiseUnresolved";
import { cruiseApi, portsApi } from "../../../lib/api";
import type { Cruise, CruiseStop, Port } from "../../../types";

/**
 * forgejo#222: the ports an import could not match, as one work list — each
 * name once with its catalogue matches, confirmed per port, a refusal kept on
 * its row, never turned into a sea day, and what stays incomplete said.
 */

vi.mock("../../../lib/api", () => ({
  cruiseApi: { update: vi.fn() },
  portsApi: { search: vi.fn(), geocode: vi.fn().mockResolvedValue({ ports: [], failure: null }) },
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const colon = {
  id: 77,
  name: "Colón",
  city: "Colón",
  country: "Panama",
  timezone: "America/Panama",
} as Port;
const kiel = {
  id: 1,
  name: "Kiel",
  city: "Kiel",
  country: "Germany",
  timezone: "Europe/Berlin",
} as Port;

const stop = (id: string, dayNumber: number, extra: Partial<CruiseStop>): CruiseStop =>
  ({
    id,
    cruiseId: "c1",
    portId: null,
    port: null,
    dayNumber,
    date: null,
    isAtSea: false,
    arrivalTime: null,
    departureTime: null,
    excursionNote: null,
    unresolvedPortName: null,
    ...extra,
  }) as CruiseStop;

const cruise = {
  id: "c1",
  departurePort: null,
  arrivalPort: null,
  stops: [
    stop("s1", 1, { portId: 1, port: kiel }),
    stop("s4", 4, {
      unresolvedPortName: "Colon ",
      arrivalTime: "2026-10-08T07:00:00.000Z",
      excursionNote: "Kanal",
    }),
    stop("s5", 5, { isAtSea: true }),
    stop("s9", 9, { unresolvedPortName: "colon" }),
    stop("s7", 7, { unresolvedPortName: "Isla Margarita" }),
  ],
} as unknown as Cruise;

describe("unresolvedGroups / resolveStops", () => {
  it("lists each imported name once, with every day it appears on", () => {
    expect(unresolvedGroups(cruise)).toEqual([
      { name: "Colon", key: "colon", days: [4, 9] },
      { name: "Isla Margarita", key: "isla margarita", days: [7] },
    ]);
  });

  it("makes every stop of that name a call at the port, keeping its day, time and note", () => {
    const input = cruise.stops.map((s) => ({ ...s, excursionNote: s.excursionNote ?? undefined }));
    const out = resolveStops(input, "colon", colon);
    expect(out[1]).toMatchObject({
      portId: 77,
      unresolvedPortName: null,
      isAtSea: false,
      dayNumber: 4,
      arrivalTime: "2026-10-08T07:00:00.000Z",
      excursionNote: "Kanal",
    });
    expect(out[3]).toMatchObject({ portId: 77, isAtSea: false, unresolvedPortName: null });
    expect(out[4]).toMatchObject({ unresolvedPortName: "Isla Margarita", portId: null });
    expect(out[2]).toMatchObject({ isAtSea: true, portId: null });
  });
});

describe("CruiseUnresolvedPorts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(portsApi.search).mockImplementation(async (q: string) =>
      q.trim().toLowerCase() === "colon" ? [colon] : []
    );
  });

  it("says what stays incomplete, and offers the catalogue's match per name", async () => {
    render(<CruiseUnresolvedPorts cruise={cruise} onUpdated={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "unresolved.title" })).toBeInTheDocument();
    expect(screen.getByText("unresolved.incomplete")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    // The one clear match is offered pre-chosen; the other row has none.
    expect(await within(rows[0]).findByRole("radio", { name: /Colón/ })).toBeChecked();
    expect(await within(rows[1]).findByText("unresolved.noCandidates")).toBeInTheDocument();
    // There is no way to make it a sea day here.
    expect(screen.queryByText(/at_sea/)).toBeNull();
  });

  it("assigns the port on confirmation, never as a sea day, and reports it", async () => {
    const updated = { ...cruise, stops: [] } as unknown as Cruise;
    vi.mocked(cruiseApi.update).mockResolvedValue(updated);
    const onUpdated = vi.fn();
    render(<CruiseUnresolvedPorts cruise={cruise} onUpdated={onUpdated} />);
    const row = screen.getAllByRole("listitem")[0];
    await within(row).findByRole("radio", { name: /Colón/ });

    await userEvent.click(within(row).getByRole("button", { name: "unresolved.confirm" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
    const [id, body] = vi.mocked(cruiseApi.update).mock.calls[0];
    expect(id).toBe("c1");
    const days = new Map((body.stops ?? []).map((s) => [s.dayNumber, s]));
    expect(days.get(4)).toMatchObject({ portId: 77, isAtSea: false, unresolvedPortName: null });
    expect(days.get(9)).toMatchObject({ portId: 77, isAtSea: false, unresolvedPortName: null });
    expect(days.get(7)).toMatchObject({ portId: null, unresolvedPortName: "Isla Margarita" });
    expect(days.get(5)).toMatchObject({ isAtSea: true });
    // The other stops travel with their own data: Kiel stays Kiel.
    expect(days.get(1)).toMatchObject({ portId: 1 });
  });

  it("keeps a refused row with its reason, and lets it be tried again", async () => {
    vi.mocked(cruiseApi.update)
      .mockRejectedValueOnce({ isAxiosError: true, message: "Network Error" })
      .mockResolvedValueOnce(cruise);
    const onUpdated = vi.fn();
    render(<CruiseUnresolvedPorts cruise={cruise} onUpdated={onUpdated} />);
    const row = screen.getAllByRole("listitem")[0];
    await within(row).findByRole("radio", { name: /Colón/ });

    await userEvent.click(within(row).getByRole("button", { name: "unresolved.confirm" }));
    expect(await within(row).findByRole("alert")).toHaveTextContent("common:saveErrors.network");
    expect(onUpdated).not.toHaveBeenCalled();
    expect(within(row).getByRole("radio", { name: /Colón/ })).toBeChecked();

    await userEvent.click(within(row).getByRole("button", { name: "unresolved.confirm" }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
  });

  it("says when the catalogue could not be searched, and searches again", async () => {
    vi.mocked(portsApi.search).mockRejectedValueOnce(new Error("down")).mockResolvedValue([colon]);
    render(
      <CruiseUnresolvedPorts
        cruise={{ ...cruise, stops: cruise.stops.slice(0, 2) } as Cruise}
        onUpdated={vi.fn()}
      />
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("unresolved.searchFailed");
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    expect(await screen.findByRole("radio", { name: /Colón/ })).toBeChecked();
  });

  // Review M5: names that fold to the same id ("Colón", "Colán") kept one
  // radio group between them.
  it("gives each row its own choice, whatever the names fold to", async () => {
    vi.mocked(portsApi.search).mockResolvedValue([colon]);
    const twins = {
      ...cruise,
      stops: [
        stop("a", 2, { unresolvedPortName: "Colón" }),
        stop("b", 3, { unresolvedPortName: "Colán" }),
      ],
    } as unknown as Cruise;
    render(<CruiseUnresolvedPorts cruise={twins} onUpdated={vi.fn()} />);
    const [first, second] = screen.getAllByRole("listitem");
    const a = await within(first).findByRole("radio");
    const b = await within(second).findByRole("radio");
    expect(a.getAttribute("name")).not.toBe(b.getAttribute("name"));
    expect(a).toBeChecked();
    expect(b).toBeChecked();
  });
});
