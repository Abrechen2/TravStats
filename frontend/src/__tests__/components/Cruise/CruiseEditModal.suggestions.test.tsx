import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseEditModal } from "../../../components/Cruise/CruiseEditModal";
import { cruiseApi, companionsApi, shipsApi, tripsApi } from "../../../lib/api";
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

  describe("end date", () => {
    const endInput = (): HTMLInputElement =>
      screen.getAllByLabelText("field.arrive")[0] as HTMLInputElement;

    it("follows the last day of the cruise while the user has not touched it", async () => {
      render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
      fireEvent.change(screen.getByLabelText("field.depart"), {
        target: { value: "2026-07-01" },
      });
      const add = screen.getByRole("button", { name: /stops.add/ });
      await userEvent.click(add);
      expect(endInput().value).toBe("");
      await userEvent.click(add);
      await userEvent.click(add);

      await waitFor(() => expect(endInput().value).toBe("2026-07-03"));
    });

    it("stops following once the user edits it", async () => {
      render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
      fireEvent.change(screen.getByLabelText("field.depart"), {
        target: { value: "2026-07-01" },
      });
      const add = screen.getByRole("button", { name: /stops.add/ });
      await userEvent.click(add);
      await userEvent.click(add);
      await waitFor(() => expect(endInput().value).toBe("2026-07-02"));

      fireEvent.change(endInput(), { target: { value: "2026-07-10" } });
      await userEvent.click(add);

      expect(endInput().value).toBe("2026-07-10");
      expect((await savedPayload()).endDate).toBe("2026-07-10T00:00:00.000Z");
    });

    it("never replaces the end date an existing cruise was loaded with", async () => {
      const cruise = {
        id: "cruise-1",
        startDate: "2026-01-01T00:00:00.000Z",
        endDate: "2026-01-20T00:00:00.000Z",
        status: "scheduled",
        currency: "EUR",
        tags: [],
        companions: [],
        stops: [{ portId: null, port: null, dayNumber: 8, date: null, isAtSea: true }],
      } as unknown as Cruise;
      render(<CruiseEditModal mode="edit" cruise={cruise} onClose={vi.fn()} onSaved={vi.fn()} />);

      await waitFor(() => expect(stopDates()).toEqual(["2026-01-08"]));
      expect(endInput().value).toBe("2026-01-20");
    });
  });

  describe("route name", () => {
    const kiel = { id: 1, name: "Kiel" };
    const withPorts = (routeName: string | null) =>
      ({
        id: "cruise-1",
        routeName,
        departurePort: kiel,
        arrivalPort: kiel,
        startDate: null,
        endDate: null,
        status: "scheduled",
        currency: "EUR",
        tags: [],
        companions: [],
        stops: [
          { portId: 2, port: { id: 2, name: "Oslo" }, dayNumber: 2, date: null, isAtSea: false },
        ],
      }) as unknown as Cruise;

    it("offers a name built from the ports and fills it only on a click", async () => {
      vi.mocked(cruiseApi.update).mockReset().mockResolvedValue(withPorts(null));
      render(
        <CruiseEditModal mode="edit" cruise={withPorts(null)} onClose={vi.fn()} onSaved={vi.fn()} />
      );
      const route = screen.getByLabelText("field.routeName") as HTMLInputElement;
      expect(route.value).toBe("");

      await userEvent.click(screen.getByRole("button", { name: "form.routeNameSuggestion" }));

      expect(route.value).toBe("Kiel → Oslo → Kiel");
      expect(screen.queryByRole("button", { name: "form.routeNameSuggestion" })).toBeNull();
    });

    it("offers nothing over a name the cruise already has", async () => {
      render(
        <CruiseEditModal
          mode="edit"
          cruise={withPorts("Norwegen")}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );
      // Let the trip list settle, so the assertion below is not made mid-load.
      await act(async () => {});
      expect(screen.getByLabelText("field.routeName")).toHaveValue("Norwegen");
      expect(screen.queryByRole("button", { name: "form.routeNameSuggestion" })).toBeNull();
    });
  });

  describe("cruise line", () => {
    it("suggests lines from the server and takes a pick as the value", async () => {
      vi.mocked(shipsApi.cruiseLines).mockReset().mockResolvedValue(["AIDA Cruises"]);
      render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
      const line = screen.getByLabelText("field.line");

      await userEvent.type(line, "ai");
      await userEvent.click(await screen.findByRole("button", { name: "AIDA Cruises" }));

      expect(shipsApi.cruiseLines).toHaveBeenCalledWith("ai");
      expect(line).toHaveValue("AIDA Cruises");
      expect((await savedPayload()).cruiseLine).toBe("AIDA Cruises");
    });

    it("keeps a line no source knows", async () => {
      vi.mocked(shipsApi.cruiseLines).mockReset().mockResolvedValue([]);
      render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);

      await userEvent.type(screen.getByLabelText("field.line"), "Hurtigruten Expeditions");

      expect((await savedPayload()).cruiseLine).toBe("Hurtigruten Expeditions");
    });
  });
});
