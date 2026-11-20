import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const summarize = vi.fn();
vi.mock("../../../lib/api", () => ({
  tripsApi: { summarize: (...args: unknown[]) => summarize(...args) },
}));

const beta = vi.hoisted(() => ({ federated: false }));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    betaFeaturesEnabled: true,
    isFeatureVisible: (key: string) => key === "federatedTripSharing" && beta.federated,
  }),
}));
const remote = vi.hoisted(() => ({
  status: vi.fn(),
  tripSharing: vi.fn(),
}));
vi.mock("../../../lib/api/sharingRemote", () => ({ sharingRemoteApi: remote }));

const llm = vi.hoisted(() => ({ current: true as boolean | "disabled" | null }));
vi.mock("../../../hooks/useHasLlm", () => ({ useHasLlm: () => llm.current }));
const demo = vi.hoisted(() => ({ shared: false }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.shared }));
const travTrack = vi.hoisted(() => ({ on: false }));
vi.mock("../../../hooks/useTravTrackVisible", () => ({ useTravTrackVisible: () => travTrack.on }));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const pick = vi.fn();
vi.mock("../../sharing/useTripShareDialogs", () => ({
  SHARE_ITEMS: ["companions", "link", "route"],
  useTripShareDialogs: () => ({ pick, loading: false, node: null }),
}));
vi.mock("../../sharing/useRemoteShareBlock", () => ({ useRemoteShareBlock: () => null }));
vi.mock("../../sharing/RemoteTripPeople", () => ({
  default: ({ bare }: { bare?: boolean }) => <div>remote-people {bare ? "bare" : ""}</div>,
}));
vi.mock("../TripExportModal", () => ({
  TripExportModal: () => <div>export-dialog</div>,
}));

import TripMoreMenu from "../TripMoreMenu";
import type { Trip } from "../../../types";

const trip = { id: "t1", name: "Köln", summary: null } as unknown as Trip;

function renderMenu(overrides: Partial<Trip> = {}, extra: { onDelete?: () => void } = {}) {
  const onDelete = extra.onDelete ?? vi.fn();
  const onChanged = vi.fn();
  render(
    <TripMoreMenu
      trip={{ ...trip, ...overrides } as Trip}
      language="de"
      onDelete={onDelete}
      onChanged={onChanged}
    />
  );
  return { onDelete, onChanged };
}

const open = () => fireEvent.click(screen.getByTestId("trip-more-menu"));
const entry = (name: string) => screen.queryByRole("menuitem", { name });

describe("TripMoreMenu — the rare actions behind one Mehr button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    beta.federated = false;
    llm.current = true;
    demo.shared = false;
    travTrack.on = false;
    remote.status.mockResolvedValue({ available: true });
    remote.tripSharing.mockResolvedValue({ homeOrigin: null });
  });

  it("holds sharing, export and the AI summary, with delete last", () => {
    renderMenu();
    open();
    const labels = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(labels).toEqual([
      "sharing:menu.companions",
      "sharing:menu.link",
      "trips:export.button",
      "trips:menu.summaryNone",
      "common:buttons.delete",
    ]);
  });

  it("closes the menu on Escape and hands focus back to the trigger", () => {
    renderMenu();
    open();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("trip-more-menu"));
  });

  it("moves between entries with the arrow keys", () => {
    renderMenu();
    open();
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("hands a share entry to the sharing dialogs", () => {
    renderMenu();
    open();
    fireEvent.click(entry("sharing:menu.link")!);
    expect(pick).toHaveBeenCalledWith("link");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the export dialog from the menu", () => {
    renderMenu();
    open();
    fireEvent.click(entry("trips:export.button")!);
    expect(screen.getByText("export-dialog")).toBeInTheDocument();
  });

  it("asks nothing is deleted by the menu itself: delete only calls the page's confirm", () => {
    const { onDelete } = renderMenu();
    open();
    fireEvent.click(entry("common:buttons.delete")!);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("offers the route share only where TravTrack is", () => {
    renderMenu();
    open();
    expect(entry("sharing:menu.route")).toBeNull();
  });

  it("offers the route share where TravTrack is offered", () => {
    travTrack.on = true;
    renderMenu();
    open();
    expect(entry("sharing:menu.route")).not.toBeNull();
  });

  it("opens the offer-to-another-server UI in a dialog, where federation is on", async () => {
    beta.federated = true;
    renderMenu();
    await waitFor(() => expect(remote.tripSharing).toHaveBeenCalled());
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "trips:menu.remote" }));
    expect(screen.getByText("remote-people bare")).toBeInTheDocument();
  });

  it("has no other-server entry while the beta key is off", () => {
    renderMenu();
    open();
    expect(entry("trips:menu.remote")).toBeNull();
    expect(remote.status).not.toHaveBeenCalled();
  });

  it("has no other-server entry when the server has federation off", async () => {
    beta.federated = true;
    remote.status.mockResolvedValue({ available: false, reason: "switch-off" });
    renderMenu();
    await waitFor(() => expect(remote.status).toHaveBeenCalled());
    open();
    expect(entry("trips:menu.remote")).toBeNull();
  });

  it("has no other-server entry on a trip that came from another server", async () => {
    beta.federated = true;
    remote.tripSharing.mockResolvedValue({ homeOrigin: "https://home.example" });
    renderMenu();
    await waitFor(() => expect(remote.tripSharing).toHaveBeenCalled());
    open();
    expect(entry("trips:menu.remote")).toBeNull();
  });

  it("shows the shared demo account neither sharing, offering nor summary", async () => {
    demo.shared = true;
    beta.federated = true;
    renderMenu();
    // The lookup still answers "yes"; the demo refusal is what keeps the entry out.
    await waitFor(() => expect(remote.tripSharing).toHaveBeenCalled());
    open();
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "trips:export.button",
      "common:buttons.delete",
    ]);
  });
});

describe("TripMoreMenu — the AI summary entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    beta.federated = false;
    llm.current = true;
    demo.shared = false;
    travTrack.on = false;
    summarize.mockResolvedValue({ summary: "…", model: "m", language: "en", durationMs: 1 });
  });

  it("is absent where the instance has no text model", () => {
    llm.current = false;
    renderMenu();
    open();
    expect(entry("trips:menu.summaryNone")).toBeNull();
  });

  it("is absent where an admin switched the model off", () => {
    llm.current = "disabled";
    renderMenu();
    open();
    expect(entry("trips:menu.summaryNone")).toBeNull();
  });

  it("stays while the capability answer is still outstanding", () => {
    llm.current = null;
    renderMenu();
    open();
    expect(entry("trips:menu.summaryNone")).not.toBeNull();
  });

  it("says 'again' on a trip that already has a summary", () => {
    renderMenu({ summary: "Elf Tage." });
    open();
    expect(entry("trips:menu.summaryAgain")).not.toBeNull();
  });

  it("writes the summary in the reader's language and reloads the trip", async () => {
    const { onChanged } = renderMenu();
    open();
    fireEvent.click(entry("trips:menu.summaryNone")!);
    await waitFor(() => expect(summarize).toHaveBeenCalledWith("t1", "de"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("names the admin switch when the server refuses with LLM_DISABLED after the page loaded", async () => {
    summarize.mockRejectedValue({ response: { status: 503, data: { code: "LLM_DISABLED" } } });
    renderMenu();
    open();
    fireEvent.click(entry("trips:menu.summaryNone")!);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("error", "trips:summary.disabled"));
  });
});
