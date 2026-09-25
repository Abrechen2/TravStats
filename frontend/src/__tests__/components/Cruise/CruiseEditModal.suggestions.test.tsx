import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseEditModal } from "../../../components/Cruise/CruiseEditModal";
import { cruiseApi, companionsApi, tripsApi } from "../../../lib/api";
import type { Cruise } from "../../../types";

/**
 * Entry suggestions in the cruise form: values the form can derive from data
 * already in it are filled only where empty, and never over something typed.
 */

vi.mock("../../../lib/api", () => ({
  cruiseApi: { create: vi.fn(), update: vi.fn() },
  portsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  shipsApi: {
    search: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    cruiseLines: vi.fn().mockResolvedValue([]),
  },
  companionsApi: { list: vi.fn() },
  tripsApi: { getAll: vi.fn() },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
    ready: true,
  }),
}));

vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});

const stopDates = (): string[] =>
  screen.getAllByLabelText("stops.date").map((el) => (el as HTMLInputElement).value);

async function savedPayload(): Promise<Parameters<typeof cruiseApi.create>[0]> {
  await userEvent.click(screen.getByRole("button", { name: /form\.save/i }));
  await waitFor(() => expect(cruiseApi.create).toHaveBeenCalled());
  const calls = vi.mocked(cruiseApi.create).mock.calls;
  return calls[calls.length - 1][0];
}

describe("CruiseEditModal — entry suggestions", () => {
  beforeEach(() => {
    vi.mocked(companionsApi.list).mockReset().mockResolvedValue([]);
    vi.mocked(tripsApi.getAll).mockReset().mockResolvedValue([]);
    vi.mocked(cruiseApi.create)
      .mockReset()
      .mockResolvedValue({ id: "c1" } as unknown as Cruise);
  });

  describe("stop dates", () => {
    it("dates each added stop from the start date and its day of the cruise", async () => {
      render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
      fireEvent.change(screen.getByLabelText("field.depart"), {
        target: { value: "2026-07-01" },
      });
      const add = screen.getByRole("button", { name: /stops.add/ });
      await userEvent.click(add);
      await userEvent.click(add);

      await waitFor(() => expect(stopDates()).toEqual(["2026-07-01", "2026-07-02"]));

      const payload = await savedPayload();
      expect(payload.stops?.map((s) => s.date)).toEqual([
        "2026-07-01T00:00:00.000Z",
        "2026-07-02T00:00:00.000Z",
      ]);
      // UI-only bookkeeping never reaches the server.
      expect(payload.stops?.every((s) => !("dateSource" in s))).toBe(true);
    });

    it("keeps a date the user typed when the start date moves", async () => {
      render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
      const start = screen.getByLabelText("field.depart");
      fireEvent.change(start, { target: { value: "2026-07-01" } });
      const add = screen.getByRole("button", { name: /stops.add/ });
      await userEvent.click(add);
      await userEvent.click(add);
      fireEvent.change(screen.getAllByLabelText("stops.date")[1], {
        target: { value: "2026-07-05" },
      });

      fireEvent.change(start, { target: { value: "2026-08-01" } });

      await waitFor(() => expect(stopDates()).toEqual(["2026-08-01", "2026-07-05"]));
    });

    it("fills an undated stop of an existing cruise without touching a dated one", async () => {
      const cruise = {
        id: "cruise-1",
        startDate: "2026-01-01T00:00:00.000Z",
        endDate: "2026-01-08T00:00:00.000Z",
        status: "scheduled",
        currency: "EUR",
        tags: [],
        companions: [],
        stops: [
          { portId: null, port: null, dayNumber: 1, date: null, isAtSea: true },
          {
            portId: null,
            port: null,
            dayNumber: 8,
            date: "2026-01-09T00:00:00.000Z",
            isAtSea: true,
          },
        ],
      } as unknown as Cruise;
      render(<CruiseEditModal mode="edit" cruise={cruise} onClose={vi.fn()} onSaved={vi.fn()} />);

      await waitFor(() => expect(stopDates()).toEqual(["2026-01-01", "2026-01-09"]));
    });
  });
});
