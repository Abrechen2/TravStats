import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { rideFixture } from "../../components/bus/__tests__/busFixture";
import type { BusJourney } from "../../types/bus";

// The real German copy, so the test reads what the reader sees.
// The entry photo strip has its own suite; here it would reach the network.
vi.mock("../../components/common/EntryPhotos", () => ({
  default: () => null,
  EntryPhotos: () => null,
  EntryPhotosSection: () => null,
}));

vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
// The operator service answers "there is a logo" for every name here.
vi.mock("../../lib/api/operators", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/api/operators")>();
  return {
    ...actual,
    getOperatorMark: () => Promise.resolve({ available: true, source: "catalogue", credit: null }),
  };
});

const getMock = vi.fn();
const removeMock = vi.fn();
const routingMock = vi.fn();
const routeAgainMock = vi.fn();
const keepStraightMock = vi.fn();
const clearManualMock = vi.fn();
vi.mock("../../lib/api/bus", () => ({
  busApi: {
    get: (...a: unknown[]) => getMock(...a),
    remove: (...a: unknown[]) => removeMock(...a),
    routing: () => routingMock(),
    routeAgain: (...a: unknown[]) => routeAgainMock(...a),
    keepStraight: (...a: unknown[]) => keepStraightMock(...a),
    clearManualRoute: (...a: unknown[]) => clearManualMock(...a),
  },
}));
// Its own suite covers it; here it would only reach for the network.
vi.mock("../../components/documents/DocumentsSection", () => ({
  default: ({ entry }: { entry: { type: string; id: string } }) => (
    <div data-testid="documents-stub">{`${entry.type}:${entry.id}`}</div>
  ),
}));
vi.mock("../../components/bus/BusRouteEditor", () => ({
  BusRouteEditor: ({ onSaved, ride }: { onSaved: (r: unknown) => void; ride: BusJourney }) => (
    <button
      data-testid="bus-editor-stub"
      onClick={() => onSaved({ ...ride, geometrySource: "manual" })}
    />
  ),
}));
vi.mock("../../components/bus/BusRouteMap", () => ({
  BusRouteMap: ({ ride }: { ride: { id: string } }) => (
    <div data-testid="bus-map-stub">{ride.id}</div>
  ),
}));
vi.mock("../../components/common/TripPhotoWindowStrip", () => ({
  default: ({ entry, id }: { entry: string; id: string }) => (
    <div data-testid="photo-window-stub">{`${entry}:${id}`}</div>
  ),
}));
vi.mock("../../components/bus/BusFormModal", () => ({
  BusFormModal: ({
    journey,
    afterSaveFailedKey,
  }: {
    journey: { id: string } | null;
    afterSaveFailedKey?: string;
  }) => (
    <div data-testid="bus-editor" data-after-save-failed-key={afterSaveFailedKey}>
      {journey?.id ?? "new"}
    </div>
  ),
}));
vi.mock("../../components/ui/ConfirmModal", () => ({
  default: ({
    isOpen,
    message,
    confirmButtonClass,
    onConfirm,
  }: {
    isOpen: boolean;
    message: string;
    confirmButtonClass?: string;
    onConfirm: () => void;
  }) =>
    isOpen ? (
      <div>
        <p data-testid="confirm-message">{message}</p>
        <button type="button" onClick={onConfirm} className={confirmButtonClass}>
          confirm-delete
        </button>
      </div>
    ) : null,
}));
const documentCount = vi.hoisted(() => ({ value: 0 as number | null }));
vi.mock("../../hooks/useDocumentCount", () => ({ useDocumentCount: () => documentCount.value }));
const addToast = vi.fn();
vi.mock("../../store/pageErrorStore", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reportPageError: (message: string, tone = "error") => addToast(tone, message),
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ addToast }),
}));
vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

import BusDetailPage from "../BusDetailPage";
import { chooseMenuEntry } from "../../__tests__/helpers/menu";

async function renderPage(loaded: BusJourney | Error, url = "/bus/r1"): Promise<void> {
  if (loaded instanceof Error) getMock.mockRejectedValue(loaded);
  else getMock.mockResolvedValue(loaded);
  // The load settles inside act, so the state it sets is not an unwrapped update.
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/bus/:id" element={<BusDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
  });
}

/** An entry with a confirmation: choose it, then confirm in the dialog that follows. */
function chooseConfirmed(trigger: HTMLElement, entry: string): void {
  chooseMenuEntry(trigger, entry);
  // The mocked confirm dialog above has one button.
  fireEvent.click(screen.getByRole("button", { name: "confirm-delete" }));
}

const notFound = (): Error =>
  Object.assign(new Error("gone"), { isAxiosError: true, response: { status: 404 } });

describe("BusDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    removeMock.mockReset();
    routingMock.mockReset();
    routingMock.mockResolvedValue({ configured: true, providerId: "graphhopper" });
    routeAgainMock.mockReset();
    keepStraightMock.mockReset();
    clearManualMock.mockReset();
    addToast.mockReset();
    navigate.mockReset();
    documentCount.value = 0;
  });

  it("shows the terminals, each time on its terminal's clock, the duration and the distance", async () => {
    await renderPage(rideFixture());
    expect(
      await screen.findByText("Seoul Express Bus Terminal → Sokcho Express Bus Terminal")
    ).toBeInTheDocument();
    // 00:00 and 02:20 UTC, read in Seoul (+09:00).
    expect(screen.getByText(/09:00/)).toBeInTheDocument();
    expect(screen.getByText(/11:20/)).toBeInTheDocument();
    expect(screen.getByText("2 h 20 min")).toBeInTheDocument();
    // A measured chord is labelled as one.
    expect(screen.getByText("159 km")).toBeInTheDocument();
    expect(screen.getByText("Entfernung · Luftlinie")).toBeInTheDocument();
    expect(screen.getByText("Kobus · Premium")).toBeInTheDocument();
    expect(screen.getByTestId("bus-detail-status")).toHaveTextContent("Gefahren");
  });

  it("draws the operator's logo in the header, as the list row does, not a bare bus icon", async () => {
    await renderPage(rideFixture());
    const logo = await screen.findByTestId("operator-logo");
    expect(logo.getAttribute("src")).toBe("/api/v1/operators/logo?domain=bus&name=Kobus");
  });

  it("names a typed distance 'laut Ticket' and a routed one 'Straße', never Luftlinie", async () => {
    await renderPage({ ...rideFixture(), distanceSource: "user" });
    await screen.findByText("159 km");
    expect(screen.getByText("Entfernung · laut Ticket")).toBeInTheDocument();
    expect(screen.queryByText(/Luftlinie/)).toBeNull();
  });

  it("names a routed length 'Straße' and offers no routing for a ride that has its road line", async () => {
    await renderPage({
      ...rideFixture(),
      distanceSource: "route",
      geometrySource: "road",
      geometry: [
        [127, 37.5],
        [128.6, 38.2],
      ],
    });
    await screen.findByText("159 km");
    expect(screen.getByText("Entfernung · Straße")).toBeInTheDocument();
    expect(screen.queryByText(/Luftlinie/)).toBeNull();
    expect(screen.queryByTestId("bus-route-again")).toBeNull();
  });

  describe("route again", () => {
    it("routes a straight ride and shows the road length", async () => {
      routeAgainMock.mockResolvedValue({
        ride: {
          ...rideFixture(),
          distanceKm: 214,
          distanceSource: "route",
          geometrySource: "road",
        },
        geometry: { outcome: "routed", geometrySource: "road", fallback: null },
      });
      await renderPage(rideFixture());
      chooseMenuEntry(await screen.findByTestId("bus-route-menu"), "Über die Straße berechnen");
      expect(await screen.findByTestId("bus-route-message")).toHaveTextContent(
        "Über die Straße berechnet: 214 km."
      );
      expect(screen.getByText("Entfernung · Straße")).toBeInTheDocument();
      expect(routeAgainMock).toHaveBeenCalledWith("r1");
    });

    it("words the provider's reason when it does not deliver, and the ride stays as it was", async () => {
      routeAgainMock.mockResolvedValue({
        ride: rideFixture(),
        geometry: {
          outcome: "straight",
          geometrySource: "straight",
          fallback: "point_not_near_road",
        },
      });
      await renderPage(rideFixture());
      chooseMenuEntry(await screen.findByTestId("bus-route-menu"), "Über die Straße berechnen");
      const message = await screen.findByTestId("bus-route-message");
      expect(message).toHaveTextContent(
        "Ein Terminal liegt zu weit von der nächsten Straße entfernt."
      );
      expect(message).toHaveTextContent("Die Fahrt bleibt bei der Luftlinie.");
      expect(screen.getByText("Entfernung · Luftlinie")).toBeInTheDocument();
    });

    it("words a failed request instead of failing silently", async () => {
      routeAgainMock.mockRejectedValue(new Error("Network Error"));
      await renderPage(rideFixture());
      chooseMenuEntry(await screen.findByTestId("bus-route-menu"), "Über die Straße berechnen");
      expect(await screen.findByTestId("bus-route-message")).toHaveTextContent(
        "Die Berechnung ist nicht angekommen"
      );
    });

    it("on an instance without a provider says so instead of offering a button that cannot work", async () => {
      routingMock.mockResolvedValue({ configured: false, providerId: null });
      await renderPage(rideFixture());
      expect(await screen.findByTestId("bus-no-routing")).toHaveTextContent(
        "Ohne Routing-Dienst bleibt es bei der Luftlinie."
      );
      expect(screen.queryByRole("button", { name: "Über die Straße berechnen" })).toBeNull();
    });
  });

  describe("hand-drawn line (GitHub #409)", () => {
    const road = (): BusJourney => ({
      ...rideFixture(),
      geometrySource: "road",
      geometry: [
        [127.0046, 37.5048],
        [127.5, 37.9],
        [128.5918, 38.1911],
      ],
    });

    it("opens the editor from the route section and shows the saved manual line", async () => {
      await renderPage(road());
      fireEvent.click(await screen.findByTestId("bus-route-draw"));
      fireEvent.click(await screen.findByTestId("bus-editor-stub"));
      expect(await screen.findByTestId("bus-route-draw")).toHaveTextContent("Linie bearbeiten");
    });

    it("keeps a road ride straight and says so", async () => {
      keepStraightMock.mockResolvedValue({ ...road(), geometrySource: "manual", geometry: null });
      await renderPage(road());
      chooseConfirmed(await screen.findByTestId("bus-route-menu"), "Bei der Luftlinie lassen");
      expect(await screen.findByTestId("bus-route-message")).toHaveTextContent(
        "Die Fahrt bleibt bei der Luftlinie."
      );
      expect(keepStraightMock).toHaveBeenCalledWith("r1", expect.anything());
    });

    it("words a failed keep-straight instead of failing silently", async () => {
      keepStraightMock.mockRejectedValue(new Error("Network Error"));
      await renderPage(road());
      chooseConfirmed(await screen.findByTestId("bus-route-menu"), "Bei der Luftlinie lassen");
      expect(await screen.findByTestId("bus-route-message")).toHaveTextContent(
        "Das Beibehalten der Luftlinie ist nicht angekommen"
      );
    });

    it("removes a manual line and reports that the road was routed again", async () => {
      clearManualMock.mockResolvedValue({ data: road(), meta: { busRoute: "routed" } });
      await renderPage({ ...road(), geometrySource: "manual" });
      chooseConfirmed(
        await screen.findByTestId("bus-route-menu"),
        "Handgezeichnete Linie entfernen"
      );
      expect(await screen.findByTestId("bus-route-message")).toHaveTextContent(
        "die Straße wurde neu berechnet"
      );
    });

    it("words a failed removal, and a version conflict by its own sentence", async () => {
      clearManualMock.mockRejectedValue({
        response: { data: { error: "x", code: "VERSION_CONFLICT" } },
      });
      await renderPage({ ...road(), geometrySource: "manual" });
      chooseConfirmed(
        await screen.findByTestId("bus-route-menu"),
        "Handgezeichnete Linie entfernen"
      );
      expect(await screen.findByTestId("bus-route-message")).toHaveTextContent(
        "Die Fahrt wurde zwischenzeitlich geändert"
      );
    });
  });

  it("draws the ride on a map under 'Strecke'", async () => {
    await renderPage(rideFixture());
    expect(await screen.findByTestId("bus-map-stub")).toHaveTextContent("r1");
    expect(screen.getByText("Strecke")).toBeInTheDocument();
  });

  it("shows the trip's photos taken on board when the ride is on a trip", async () => {
    await renderPage({ ...rideFixture(), tripId: "t1" });
    expect(await screen.findByTestId("photo-window-stub")).toHaveTextContent("bus:r1");
  });

  it("asks for no photo window when the ride is on no trip", async () => {
    await renderPage(rideFixture());
    await screen.findByTestId("bus-map-stub");
    expect(screen.queryByTestId("photo-window-stub")).toBeNull();
  });

  it("keeps an unrecorded delay apart from an on-time arrival", async () => {
    await renderPage({ ...rideFixture(), delayMinutes: null });
    expect(await screen.findByText("nicht erfasst")).toBeInTheDocument();
    expect(screen.queryByText("pünktlich")).toBeNull();
  });

  it("says an on-time arrival is on time", async () => {
    await renderPage({ ...rideFixture(), delayMinutes: 0 });
    expect(await screen.findByText("pünktlich")).toBeInTheDocument();
  });

  it("files the ride's documents under the bus entry type", async () => {
    await renderPage(rideFixture());
    expect(await screen.findByTestId("documents-stub")).toHaveTextContent("busJourney:r1");
  });

  it("says the ride does not exist on a 404", async () => {
    await renderPage(notFound());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Diese Busfahrt gibt es nicht (mehr)."
    );
    expect(screen.queryByRole("button", { name: "Erneut versuchen" })).toBeNull();
  });

  it("offers a retry, not a denial, when the ride could not be loaded", async () => {
    await renderPage(new Error("network down"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Busfahrt konnte nicht geladen werden."
    );
    getMock.mockResolvedValue(rideFixture());
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(
      await screen.findByText("Seoul Express Bus Terminal → Sokcho Express Bus Terminal")
    ).toBeInTheDocument();
  });

  it("opens the editor from the edit button", async () => {
    await renderPage(rideFixture());
    fireEvent.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    expect(screen.getByTestId("bus-editor")).toHaveTextContent("r1");
  });

  it("opens the editor straight away for a ?edit=1 link", async () => {
    await renderPage(rideFixture(), "/bus/r1?edit=1");
    expect(await screen.findByTestId("bus-editor")).toHaveTextContent("r1");
  });

  it("deletes the ride after the confirmation and returns to the logbook", async () => {
    removeMock.mockResolvedValue(undefined);
    await renderPage(rideFixture());
    fireEvent.click(await screen.findByTestId("detail-more-menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Löschen" }));
    fireEvent.click(screen.getByText("confirm-delete"));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/bus"));
  });

  it("stays on the page and says so when the delete fails", async () => {
    removeMock.mockRejectedValue(new Error("nope"));
    await renderPage(rideFixture());
    fireEvent.click(await screen.findByTestId("detail-more-menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Löschen" }));
    fireEvent.click(screen.getByText("confirm-delete"));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "Die Busfahrt konnte nicht gelöscht werden.")
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  // forgejo#250: the same question the list asks, from the same function.
  it("names the ride, its documents, and the trip and companions that stay, with a red confirm", async () => {
    documentCount.value = 3;
    await renderPage({
      ...rideFixture(),
      trip: { id: "t1", name: "Korea 2026", color: "#123456" },
      tripId: "t1",
      companions: ["Mina"],
    });
    fireEvent.click(await screen.findByTestId("detail-more-menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Löschen" }));
    const message = screen.getByTestId("confirm-message").textContent ?? "";
    expect(message).toContain(
      "Die Busfahrt Seoul Express Bus Terminal → Sokcho Express Bus Terminal wirklich löschen?"
    );
    expect(message).toContain("Dazu 3 Dokumente: werden nur gelöst");
    expect(message).toContain("Erhalten bleiben: Reise „Korea 2026“, 1 mitreisende Person");
    expect(screen.getByText("confirm-delete").className).toContain("var(--danger)");
  });

  // forgejo#247: a stored edit whose page reload fails names the VIEW, not a list.
  it("tells the form that a failed refresh here is the view's", async () => {
    await renderPage(rideFixture());
    fireEvent.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    expect(screen.getByTestId("bus-editor")).toHaveAttribute(
      "data-after-save-failed-key",
      "common:form.savedButViewRefreshFailed"
    );
  });
});

// forgejo#393: the FX snapshot is stored with the price; the page now says how it was converted.
describe("BusDetailPage — FX snapshot", () => {
  beforeEach(() => {
    getMock.mockReset();
    routingMock.mockReset();
    routingMock.mockResolvedValue({ configured: true, providerId: "graphhopper" });
    documentCount.value = 0;
  });

  it("shows the conversion of a foreign-currency fare", async () => {
    await renderPage({
      ...rideFixture(),
      price: 20000,
      currency: "KRW",
      priceBase: 14.5,
      fxRate: 0.000725,
      fxRateDate: "2026-03-12",
      fxBaseCurrency: "EUR",
      fxSource: "ecb",
    });
    expect(await screen.findByText("Umrechnung")).toBeInTheDocument();
    expect(screen.getByText(/→.*EZB/)).toBeInTheDocument();
  });

  it("draws no conversion row for a fare with no price", async () => {
    await renderPage({ ...rideFixture(), price: null });
    await screen.findByTestId("bus-detail-status");
    expect(screen.queryByText("Umrechnung")).toBeNull();
  });
});
