import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  FULDA_TO_BERLIN,
  makeRailJourney,
} from "../../components/rail/__tests__/railJourneyFixture";
import type { RailConnectionDetail } from "../../types/rail";

/**
 * forgejo#187, level 2: the page of a whole ride — its trains in travel order,
 * each linking to its own page, the wait at every change.
 */
const getConnection = vi.fn();
const update = vi.fn();
vi.mock("../../lib/api/rail", () => ({
  railApi: {
    getConnection: (...a: unknown[]) => getConnection(...a),
    update: (...a: unknown[]) => update(...a),
  },
}));
// The connection view lists each leg's originals through the documents router.
const listForEntry = vi.fn();
vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: (...a: unknown[]) => listForEntry(...a) },
  documentFileUrl: (doc: { url: string }) => doc.url,
}));
vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));

import RailConnectionPage from "../RailConnectionPage";

/** Frankfurt 06:15 → Fulda 07:10, then Fulda 07:25 → Berlin 10:05 (station time). */
const first = makeRailJourney();
const second = makeRailJourney({
  id: "j2",
  depStationName: "Fulda",
  arrStationName: "Berlin Hbf",
  ...FULDA_TO_BERLIN,
  departureTime: "2026-09-26T05:25:00.000Z",
  arrivalTime: "2026-09-26T08:05:00.000Z",
  trainNumber: "1090",
});

const connection = (over: Partial<RailConnectionDetail> = {}): RailConnectionDetail => ({
  id: "j1",
  legs: [first, second],
  booking: { id: "b1", pnr: "AB12CD" },
  ...over,
});

function renderAt(id = "j2"): void {
  render(
    <MemoryRouter initialEntries={[`/rail/connection/${id}`]}>
      <Routes>
        <Route path="/rail/connection/:id" element={<RailConnectionPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("RailConnectionPage", () => {
  beforeEach(() => {
    getConnection.mockReset();
    update.mockReset();
    listForEntry.mockReset().mockResolvedValue([]);
  });

  it("asks by the leg in the address and titles the ride by all its stations", async () => {
    getConnection.mockResolvedValue(connection());
    renderAt("j2");
    expect(await screen.findByText("Frankfurt → Fulda → Berlin Hbf")).toBeInTheDocument();
    expect(getConnection).toHaveBeenCalledWith("j2");
    expect(screen.getByText(/rail:connection.booking \{"pnr":"AB12CD"\}/)).toBeInTheDocument();
  });

  it("lists every train in travel order, each linking to its own page", async () => {
    getConnection.mockResolvedValue(connection());
    renderAt();
    const list = await screen.findByTestId("rail-connection-legs");
    const links = [...list.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/rail/j1", "/rail/j2"]);
    expect(links[0].textContent).toBe("1. Frankfurt → Fulda");
    expect(links[1].textContent).toBe("2. Fulda → Berlin Hbf");
    expect(screen.getByTestId("rail-connection-leg-j2").textContent).toContain("ICE 1090");
    // Station clocks: 05:25 UTC is 07:25 in Fulda.
    expect(screen.getByTestId("rail-connection-leg-j2").textContent).toContain("07:25");
  });

  it("names the station changed at and the wait there", async () => {
    getConnection.mockResolvedValue(connection());
    renderAt();
    const transfer = await screen.findByTestId("rail-transfer-1");
    expect(transfer.textContent).toContain("rail:transfer.wait");
    expect(transfer.textContent).toContain('"station":"Fulda"');
    // 07:10 → 07:25.
    expect(transfer.textContent).toContain('rail:detail.durationM {\\"m\\":15}');
  });

  it("marks the change as tight on the arriving train, and shows what is stored", async () => {
    getConnection.mockResolvedValue(connection());
    update.mockResolvedValue({ journey: { ...first, tightConnection: true }, geometry: null });
    renderAt();
    const box = await screen.findByRole("checkbox", { name: "rail:transfer.markTight" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(update).toHaveBeenCalledWith("j1", { tightConnection: true });
  });

  it("states the whole time on the way, waits included, and the number of changes", async () => {
    getConnection.mockResolvedValue(connection());
    renderAt();
    await screen.findByTestId("rail-connection-legs");
    // 04:15 → 08:05 UTC.
    expect(screen.getByText('rail:detail.durationHm {"h":3,"m":50}')).toBeInTheDocument();
    expect(screen.getByText('rail:connection.changesLabel {"count":1}')).toBeInTheDocument();
  });

  it("states no total time and no wait when an arrival is unknown", async () => {
    getConnection.mockResolvedValue(
      connection({
        legs: [
          { ...first, arrivalTime: null },
          { ...second, arrivalTime: null },
        ],
      })
    );
    renderAt();
    const transfer = await screen.findByTestId("rail-transfer-1");
    expect(transfer.textContent).toContain("rail:transfer.unknown");
    // Never a wait of 0 for a time nobody knows.
    expect(transfer.textContent).not.toContain("durationM");
    expect(screen.queryByText("rail:connection.totalDuration")).toBeNull();
  });

  it("says 'not found' for a 404 and offers no retry", async () => {
    getConnection.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("rail:connection.notFound");
    expect(screen.queryByText("common:buttons.retry")).toBeNull();
  });

  it("says a failed load as itself and loads again on retry", async () => {
    getConnection.mockRejectedValueOnce(new Error("network"));
    getConnection.mockResolvedValueOnce(connection());
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("rail:connection.loadError");
    fireEvent.click(screen.getByText("common:buttons.retry"));
    await waitFor(() => expect(getConnection).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Frankfurt → Fulda → Berlin Hbf")).toBeInTheDocument();
  });
});
