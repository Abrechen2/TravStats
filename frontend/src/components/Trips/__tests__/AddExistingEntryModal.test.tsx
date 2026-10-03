import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

/**
 * The trip's picker for EXISTING entries (forgejo#188). The real loaders and
 * the real attach calls run here; only the HTTP client is stubbed, so what is
 * asserted is what the reader sees for what the server answered — including
 * the refusals, which must arrive as their own reason and never as the
 * server's English sentence.
 */

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));

import { api } from "../../../lib/api/client";
import AddExistingEntryModal from "../AddExistingEntryModal";

const TRIP = "11111111-1111-4111-8111-111111111111";
const OTHER_TRIP = "22222222-2222-4222-8222-222222222222";

const cruise = (id: string, ship: string, tripId: string | null, startDate: string) => ({
  id,
  ship: { name: ship },
  shipNameOverride: null,
  routeName: null,
  cruiseLine: "AIDA",
  departurePort: { name: "Kiel" },
  arrivalPort: { name: "Bergen" },
  startDate,
  endDate: startDate,
  tripId,
});

const CRUISES = [
  cruise("c-free", "AIDAnova", null, "2024-06-01"),
  cruise("c-other", "Mein Schiff München", OTHER_TRIP, "2023-05-01"),
  cruise("c-here", "AIDAluna", TRIP, "2022-04-01"),
];

const ROADTRIPS = [
  {
    id: "r-1",
    name: "Norwegen mit dem Bulli",
    vehicleName: null,
    startDate: "2024-07-01",
    endDate: "2024-07-14",
    tripId: OTHER_TRIP,
  },
];

const LODGINGS = [
  {
    id: "l-1",
    name: "Hotel Adlon",
    city: "Berlin",
    country: "Germany",
    stays: [{ id: "s-1", tripId: null, checkIn: "2024-03-01", checkOut: "2024-03-03" }],
  },
  { id: "l-2", name: "Haus ohne Aufenthalt", city: null, country: null, stays: [] },
];

function httpError(status: number, data: unknown): AxiosError {
  const config = {} as InternalAxiosRequestConfig;
  const response = { status, data, statusText: "", headers: {}, config } as AxiosResponse;
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", config, {}, response);
}

function stubGet(overrides: Record<string, () => Promise<unknown>> = {}): void {
  vi.spyOn(api, "get").mockImplementation(async (url: string) => {
    if (overrides[url]) return { data: await overrides[url]() };
    if (url === "/trips") return { data: { trips: [{ id: OTHER_TRIP, name: "Nordkap 2023" }] } };
    if (url === "/cruises") return { data: { data: CRUISES, meta: { total: CRUISES.length } } };
    if (url === "/roadtrips") return { data: { roadtrips: ROADTRIPS } };
    if (url === "/lodging") return { data: { data: LODGINGS, meta: { total: LODGINGS.length } } };
    throw new Error(`unexpected GET ${url}`);
  });
}

function renderPicker(domains: Array<"cruise" | "roadtrip" | "lodging"> = ["cruise", "roadtrip"]) {
  const onClose = vi.fn();
  render(<AddExistingEntryModal tripId={TRIP} domains={domains} onClose={onClose} />);
  return onClose;
}

describe("AddExistingEntryModal", () => {
  beforeEach(() => stubGet());
  afterEach(() => vi.restoreAllMocks());

  it("offers only the enabled domains", async () => {
    renderPicker(["cruise", "roadtrip"]);
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["common:domain.cruise", "common:domain.roadtrip"]);
    await screen.findByText("AIDAnova");
  });

  it("lists the domain's entries, leaves out the ones already here and names the trip a move leaves", async () => {
    renderPicker();
    expect(await screen.findByText("AIDAnova")).toBeInTheDocument();
    expect(screen.getByText("Mein Schiff München")).toBeInTheDocument();
    expect(screen.queryByText("AIDAluna")).not.toBeInTheDocument();
    expect(screen.getByText('trips:addExisting.alreadyHere {"count":1}')).toBeInTheDocument();

    // The entry of another trip says which, and its button says "move".
    await screen.findByText('trips:addExisting.inOtherTrip {"name":"Nordkap 2023"}');
    expect(
      screen.getByRole("button", {
        name: 'trips:addExisting.moveLabel {"title":"Mein Schiff München"}',
      })
    ).toHaveTextContent("trips:addExisting.move");
    expect(
      screen.getByRole("button", { name: 'trips:addExisting.addLabel {"title":"AIDAnova"}' })
    ).toHaveTextContent("trips:addExisting.add");
  });

  it("searches without minding umlauts, and says when nothing matches", async () => {
    renderPicker();
    await screen.findByText("AIDAnova");
    const search = screen.getByRole("searchbox", { name: "trips:addExisting.searchLabel" });

    fireEvent.change(search, { target: { value: "munchen" } });
    expect(screen.getByText("Mein Schiff München")).toBeInTheDocument();
    expect(screen.queryByText("AIDAnova")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "queen mary" } });
    expect(screen.getByText("trips:addExisting.noMatches")).toBeInTheDocument();
  });

  it("files an entry through its domain's own write and reports the change on close", async () => {
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: { data: {} } });
    const onClose = renderPicker();
    fireEvent.click(
      await screen.findByRole("button", { name: 'trips:addExisting.addLabel {"title":"AIDAnova"}' })
    );

    await waitFor(() => expect(screen.queryByText("AIDAnova")).not.toBeInTheDocument());
    expect(patch).toHaveBeenCalledWith("/cruises/c-free", { tripId: TRIP });
    expect(screen.getByRole("status")).toHaveTextContent('trips:addExisting.added {"count":1}');
    expect(screen.getByText('trips:addExisting.alreadyHere {"count":2}')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "trips:addExisting.done" }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("shows a refused move as its own reason, on the entry, and keeps the entry", async () => {
    vi.spyOn(api, "patch").mockRejectedValue(
      httpError(409, {
        error: "This roadtrip's stations hold 3 photos of the trip it would leave",
        code: "ROADTRIP_HAS_TRIP_PHOTOS",
      })
    );
    const onClose = renderPicker();
    fireEvent.click(screen.getByRole("tab", { name: "common:domain.roadtrip" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: 'trips:addExisting.moveLabel {"title":"Norwegen mit dem Bulli"}',
      })
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("trips:addExisting.failure.roadtripPhotos");
    expect(screen.queryByText(/stations hold 3 photos/)).not.toBeInTheDocument();
    expect(screen.getByText("Norwegen mit dem Bulli")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("");

    fireEvent.click(screen.getByRole("button", { name: "trips:addExisting.done" }));
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("tells a vanished entry from a server fault", async () => {
    const patch = vi.spyOn(api, "patch");
    patch.mockRejectedValueOnce(httpError(404, { error: "Cruise not found" }));
    renderPicker();
    const add = await screen.findByRole("button", {
      name: 'trips:addExisting.addLabel {"title":"AIDAnova"}',
    });

    fireEvent.click(add);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "trips:addExisting.failure.notFound"
    );

    patch.mockRejectedValueOnce(httpError(500, { error: "Internal server error" }));
    fireEvent.click(add);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("trips:addExisting.failure.server")
    );
  });

  it("says a timed-out write may have landed, and asks the page to reload", async () => {
    vi.spyOn(api, "patch").mockRejectedValue(
      new AxiosError("timeout of 10000ms exceeded", "ECONNABORTED")
    );
    const onClose = renderPicker();
    fireEvent.click(
      await screen.findByRole("button", { name: 'trips:addExisting.addLabel {"title":"AIDAnova"}' })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("trips:addExisting.attachTimeout");
    fireEvent.click(screen.getByRole("button", { name: "trips:addExisting.done" }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("says why a domain's list could not be loaded, and loads it on retry", async () => {
    let attempts = 0;
    stubGet({
      "/cruises": async () => {
        attempts += 1;
        if (attempts === 1) throw new AxiosError("Network Error", "ERR_NETWORK");
        return { data: CRUISES, meta: { total: CRUISES.length } };
      },
    });
    renderPicker();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("trips:addExisting.loadFailed");
    expect(alert).toHaveTextContent("trips:addExisting.failure.network");
    expect(screen.queryByText("trips:addExisting.empty")).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: "trips:addExisting.retry" }));
    expect(await screen.findByText("AIDAnova")).toBeInTheDocument();
  });

  it("lists stays, files one under its lodging, and counts the houses that have none", async () => {
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: { data: {} } });
    renderPicker(["lodging"]);

    expect(await screen.findByText("Hotel Adlon")).toBeInTheDocument();
    expect(screen.queryByText("Haus ohne Aufenthalt")).not.toBeInTheDocument();
    expect(
      screen.getByText('trips:addExisting.unlinkable.lodging {"count":1}')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: 'trips:addExisting.addLabel {"title":"Hotel Adlon"}' })
    );
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/lodging/l-1/stays/s-1", { tripId: TRIP })
    );
  });
});
