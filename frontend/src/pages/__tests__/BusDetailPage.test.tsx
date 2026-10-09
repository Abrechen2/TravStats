import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { rideFixture } from "../../components/bus/__tests__/busFixture";
import type { BusJourney } from "../../types/bus";

// The real German copy, so the test reads what the reader sees.
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
const getMock = vi.fn();
const removeMock = vi.fn();
vi.mock("../../lib/api/bus", () => ({
  busApi: {
    get: (...a: unknown[]) => getMock(...a),
    remove: (...a: unknown[]) => removeMock(...a),
  },
}));
// Its own suite covers it; here it would only reach for the network.
vi.mock("../../components/documents/DocumentsSection", () => ({
  default: ({ entry }: { entry: { type: string; id: string } }) => (
    <div data-testid="documents-stub">{`${entry.type}:${entry.id}`}</div>
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
vi.mock("../../components/Training/ConfirmModal", () => ({
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

const notFound = (): Error =>
  Object.assign(new Error("gone"), { isAxiosError: true, response: { status: 404 } });

describe("BusDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    removeMock.mockReset();
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
    expect(screen.getByText("Luftlinie")).toBeInTheDocument();
    expect(screen.getByText("Kobus · Premium")).toBeInTheDocument();
    expect(screen.getByTestId("bus-detail-status")).toHaveTextContent("Gefahren");
  });

  it("does not call a typed distance a straight line", async () => {
    await renderPage({ ...rideFixture(), distanceSource: "user" });
    await screen.findByText("159 km");
    expect(screen.queryByText("Luftlinie")).toBeNull();
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
    fireEvent.click(await screen.findByRole("button", { name: "Löschen" }));
    fireEvent.click(screen.getByText("confirm-delete"));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/bus"));
  });

  it("stays on the page and says so when the delete fails", async () => {
    removeMock.mockRejectedValue(new Error("nope"));
    await renderPage(rideFixture());
    fireEvent.click(await screen.findByRole("button", { name: "Löschen" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Löschen" }));
    const message = screen.getByTestId("confirm-message").textContent ?? "";
    expect(message).toContain(
      "Die Busfahrt Seoul Express Bus Terminal → Sokcho Express Bus Terminal wirklich löschen?"
    );
    expect(message).toContain("Dazu 3 Dokumente, die mit gelöscht werden.");
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
