import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const summarize = vi.fn();
vi.mock("../../../lib/api", () => ({
  tripsApi: { summarize: (...args: unknown[]) => summarize(...args) },
}));

const llm = vi.hoisted(() => ({ current: true as boolean | "disabled" | null }));
vi.mock("../../../hooks/useHasLlm", () => ({ useHasLlm: () => llm.current }));
const demo = vi.hoisted(() => ({ shared: false }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.shared }));
const travTrack = vi.hoisted(() => ({ on: false }));
vi.mock("../../../hooks/useTravTrackVisible", () => ({ useTravTrackVisible: () => travTrack.on }));
const addToast = vi.fn();
vi.mock("../../../store/pageErrorStore", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reportPageError: (message: string, tone = "error") => addToast(tone, message),
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const pick = vi.fn();
vi.mock("../../sharing/useTripShareDialogs", () => ({
  SHARE_ITEMS: ["companions", "link", "route"],
  useTripShareDialogs: () => ({ pick, loading: false, node: null }),
}));
const block = vi.hoisted(() => ({ reason: null as string | null }));
vi.mock("../../sharing/useRemoteShareBlock", () => ({ useRemoteShareBlock: () => block.reason }));
vi.mock("../../sharing/TripPeopleSection", () => ({
  default: ({ bare }: { bare?: boolean }) => <div>people-section {bare ? "bare" : ""}</div>,
}));
vi.mock("../TripExportModal", () => ({
  TripExportModal: () => <div>export-dialog</div>,
}));

import TripMoreMenu from "../TripMoreMenu";
import type { Trip } from "../../../types";

const trip = {
  id: "t1",
  name: "Köln",
  summary: null,
  status: "in_progress",
  companions: ["Anna"],
} as unknown as Trip;

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
    block.reason = null;
    llm.current = true;
    demo.shared = false;
    travTrack.on = false;
  });

  it("holds sharing, the cover suggestion, export and the AI summary, with delete last", () => {
    renderMenu();
    open();
    const labels = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(labels).toEqual([
      "sharing:menu.share",
      "immich:cover.menu",
      "trips:export.button",
      "trips:menu.summaryNone",
      "changeHistory:menu",
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

  it("has ONE Teilen entry that opens a dialog with a people and a public-link section", () => {
    renderMenu();
    open();
    const labels = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(labels.filter((l) => l?.startsWith("sharing:menu"))).toEqual(["sharing:menu.share"]);
    fireEvent.click(entry("sharing:menu.share")!);
    expect(screen.queryByRole("menu")).toBeNull();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "sharing:tripShare.people" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "sharing:menu.link" })).toBeTruthy();
    expect(within(dialog).getByText("people-section bare")).toBeInTheDocument();
  });

  it("keeps adding a person from this server reachable, as a quiet link", () => {
    renderMenu();
    open();
    fireEvent.click(entry("sharing:menu.share")!);
    fireEvent.click(screen.getByRole("button", { name: "sharing:tripShare.addLocal" }));
    expect(pick).toHaveBeenCalledWith("companions");
  });

  it("hands the link button to the existing public-link dialog", () => {
    renderMenu();
    open();
    fireEvent.click(entry("sharing:menu.share")!);
    fireEvent.click(screen.getByRole("button", { name: "sharing:tripShare.createLink" }));
    expect(pick).toHaveBeenCalledWith("link");
  });

  it("says why other-server sharing is blocked only inside the dialog, never in the menu", () => {
    block.reason = "switchOff";
    renderMenu();
    open();
    expect(screen.queryByTestId("remote-share-blocked")).toBeNull();
    fireEvent.click(entry("sharing:menu.share")!);
    expect(screen.getByTestId("remote-share-blocked")).toHaveTextContent(
      "sharing:menu.remoteBlocked.switchOff"
    );
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

  it("offers the route share on a running or upcoming trip where TravTrack is offered", () => {
    travTrack.on = true;
    for (const status of ["in_progress", "planned"] as const) {
      const { unmount } = render(
        <TripMoreMenu
          trip={{ ...trip, status } as Trip}
          language="de"
          onDelete={vi.fn()}
          onChanged={vi.fn()}
        />
      );
      open();
      expect(entry("sharing:menu.route")).not.toBeNull();
      unmount();
    }
  });

  it("has no route share on a completed trip, even with TravTrack on", () => {
    travTrack.on = true;
    renderMenu({ status: "completed" });
    open();
    expect(entry("sharing:menu.route")).toBeNull();
    expect(entry("sharing:menu.share")).not.toBeNull();
  });

  it("no longer carries the other-server entry — it is a section of the Teilen dialog", () => {
    renderMenu();
    open();
    expect(entry("trips:menu.remote")).toBeNull();
  });

  it("shows the shared demo account neither sharing, the route nor a summary", () => {
    demo.shared = true;
    travTrack.on = true;
    renderMenu();
    open();
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "trips:export.button",
      "changeHistory:menu",
      "common:buttons.delete",
    ]);
  });
});

describe("TripMoreMenu — the AI summary entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    block.reason = null;
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
