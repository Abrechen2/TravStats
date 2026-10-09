import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseReimportCompare } from "../CruiseReimportCompare";
import { cruiseApi } from "../../../lib/api/cruise";
import type { Cruise, CruiseStop, CruiseStopInput, Port } from "../../../types";

/**
 * forgejo#225: a booking read again against the stored itinerary — each
 * change taken or left on its own, own notes kept, no port call twice.
 */

vi.mock("../../../lib/api/cruise", () => ({ cruiseApi: { get: vi.fn(), update: vi.fn() } }));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o
        ? `${k}(${Object.entries(o)
            .map(([key, v]) => `${key}=${String(v)}`)
            .join(",")})`
        : k,
    i18n: { language: "de" },
  }),
}));

const port = (id: number, name: string): Port => ({ id, name, timezone: "Europe/Oslo" }) as Port;

const storedStop = (id: string, day: number, p: Port, extra: Partial<CruiseStop> = {}) =>
  ({
    id,
    cruiseId: "c1",
    portId: p.id,
    port: p,
    dayNumber: day,
    date: null,
    isAtSea: false,
    arrivalTime: null,
    departureTime: null,
    excursionNote: null,
    unresolvedPortName: null,
    ...extra,
  }) as CruiseStop;

const stored = {
  id: "c1",
  shipNameOverride: "AIDAsol",
  ship: null,
  stops: [
    storedStop("s3", 3, port(2, "Oslo"), {
      departureTime: "2026-10-07T17:00:00.000Z",
      excursionNote: "Holmenkollen",
      allAboardTime: "16:30",
    }),
    storedStop("s4", 4, port(3, "Bergen"), { allAboardTime: "16:30" }),
    storedStop("s6", 6, port(4, "Ålesund"), { excursionNote: "Aksla" }),
  ],
} as unknown as Cruise;

const call = (day: number, p: Port, extra: Partial<CruiseStopInput> = {}): CruiseStopInput => ({
  dayNumber: day,
  isAtSea: false,
  portId: p.id,
  port: p,
  ...extra,
});

const imported: CruiseStopInput[] = [
  call(3, port(2, "Oslo"), { departureTime: "2026-10-07T18:30:00.000Z" }),
  call(4, port(5, "Stavanger")),
];

describe("CruiseReimportCompare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cruiseApi.get).mockResolvedValue(stored);
  });

  it("lists each change with its own box; a removal starts unticked", async () => {
    render(
      <CruiseReimportCompare conflicts={[{ existingId: "c1", stops: imported }]} onDone={vi.fn()} />
    );
    const times = await screen.findByRole("checkbox", {
      name: /reimport\.times\(day=3,title=Oslo,from=dayCard\.open – 17:00,to=dayCard\.open – 18:30\)/,
    });
    expect(times).toBeChecked();
    expect(screen.getByText(/reimport\.noteStays\(note=Holmenkollen\)/)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /reimport\.port\(day=4,from=Bergen,to=Stavanger\)/ })
    ).toBeChecked();
    const removal = screen.getByRole("checkbox", {
      name: /reimport\.removed\(day=6,title=Ålesund\)/,
    });
    expect(removal).not.toBeChecked();
    expect(screen.getByText(/reimport\.noteGoes\(note=Aksla\)/)).toBeInTheDocument();
    // Review I3: the swapped port's all-aboard time is named as going.
    expect(
      screen.getByText(/reimport\.allAboardGoes\(time=16:30,port=Bergen\)/)
    ).toBeInTheDocument();
  });

  it("applies only what is ticked, keeping the own note and the all-aboard time", async () => {
    vi.mocked(cruiseApi.update).mockResolvedValue(stored);
    const onDone = vi.fn();
    render(
      <CruiseReimportCompare conflicts={[{ existingId: "c1", stops: imported }]} onDone={onDone} />
    );
    // Leave the port swap out.
    await userEvent.click(await screen.findByRole("checkbox", { name: /reimport\.port/ }));
    await userEvent.click(screen.getByRole("button", { name: /reimport\.apply/ }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ applied: 1, unchanged: 0, kept: 0 }));
    const [id, body] = vi.mocked(cruiseApi.update).mock.calls[0];
    expect(id).toBe("c1");
    const stops = body.stops ?? [];
    expect(stops.map((s) => [s.dayNumber, s.portId])).toEqual([
      [3, 2],
      [4, 3],
      [6, 4],
    ]);
    expect(stops[0]).toMatchObject({
      excursionNote: "Holmenkollen",
      allAboardTime: "16:30",
      departureTime: { local: "2026-10-07T18:30" },
    });
  });

  it("keeps the choices on a refused save and offers the retry", async () => {
    vi.mocked(cruiseApi.update)
      .mockRejectedValueOnce({ isAxiosError: true, message: "Network Error" })
      .mockResolvedValueOnce(stored);
    const onDone = vi.fn();
    render(
      <CruiseReimportCompare conflicts={[{ existingId: "c1", stops: imported }]} onDone={onDone} />
    );
    await userEvent.click(await screen.findByRole("button", { name: /reimport\.apply/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("common:saveErrors.network");
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: /reimport\.times/ })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("asks nothing when the plan is the same, and keeps the stored plan on request", async () => {
    const same = stopsAsInput();
    const onDone = vi.fn();
    const { unmount } = render(
      <CruiseReimportCompare conflicts={[{ existingId: "c1", stops: same }]} onDone={onDone} />
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ applied: 0, unchanged: 1, kept: 0 }));
    expect(cruiseApi.update).not.toHaveBeenCalled();
    unmount();

    const onKept = vi.fn();
    render(
      <CruiseReimportCompare conflicts={[{ existingId: "c1", stops: imported }]} onDone={onKept} />
    );
    await userEvent.click(await screen.findByRole("button", { name: "reimport.keepStored" }));
    expect(onKept).toHaveBeenCalledWith({ applied: 0, unchanged: 0, kept: 1 });
    expect(cruiseApi.update).not.toHaveBeenCalled();
  });
});

function stopsAsInput(): CruiseStopInput[] {
  return stored.stops.map((s) => ({
    dayNumber: s.dayNumber,
    isAtSea: s.isAtSea,
    portId: s.portId,
    port: s.port,
    departureTime: s.departureTime,
  }));
}
