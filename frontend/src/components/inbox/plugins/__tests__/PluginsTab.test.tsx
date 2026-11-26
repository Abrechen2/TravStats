/**
 * The inbox's Plugins tab (owner 2026-11-26): nothing reaches the project archive without the
 * per-item confirmation, the values sent are the edited ones, a write can be undone, the tab
 * reports its count, and the list sorts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MaintenanceList, SuggestionPlugin } from "../../../../lib/api/suggestionPlugins";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  capabilities: vi.fn(),
  maintenance: vi.fn(),
  maintenanceInbox: vi.fn(),
  refreshMaintenanceInbox: vi.fn(),
  applyLocation: vi.fn(),
  undoLocation: vi.fn(),
  ignoreRow: vi.fn(),
}));
vi.mock("../../../../lib/api/suggestionPlugins", async (orig) => ({
  ...(await orig<typeof import("../../../../lib/api/suggestionPlugins")>()),
  suggestionPluginsApi: api,
}));
vi.mock("../../../Settings/suggestionSources/MaintenanceMap", () => ({
  default: ({ onPick }: { onPick?: (p: { lat: number; lon: number }) => void }) => (
    <button type="button" onClick={() => onPick?.({ lat: 48.1, lon: 11.5 })}>
      map-pick
    </button>
  ),
}));
vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

import PluginsTab from "../PluginsTab";
import { entriesOf, sortEntries } from "../pluginInboxModel";

const plugin: SuggestionPlugin = {
  id: "p1",
  name: "Projekte",
  url: "https://p.example",
  precision: "100m",
  enabled: true,
  backfillAllowed: false,
  secretSet: true,
  lastVersion: 1,
  lastOutcome: "ok",
  lastCalledAt: null,
  lastErrorAt: null,
  retryAt: null,
};
const LIST: MaintenanceList = {
  rows: [
    {
      rowId: "r1",
      name: "Baustelle Nord",
      street: null,
      postcode: "80331",
      town: "München",
      lat: null,
      lon: null,
      issues: ["noCoordinates"],
      proposals: [
        {
          source: "stop",
          lat: 48.137,
          lon: 11.575,
          street: "Marienplatz 1",
          confidence: "high",
          evidence: { stopStart: "2026-11-20T08:00:00Z" },
        },
      ],
    },
  ],
  notices: [
    {
      severity: "warning",
      code: "coordsMismatch",
      rowId: "r1",
      name: "Baustelle Nord",
      message: "Koordinaten liegen 4 km von der Adresse",
    },
  ],
  applied: [],
  stopsSent: 1,
  stopsWithheld: null,
};

const INBOX = (over: { failure?: string | null; data?: MaintenanceList | null } = {}) => ({
  blocked: null,
  plugins: [
    {
      plugin,
      data: over.data === undefined ? LIST : over.data,
      stopsSent: 1,
      stopsWithheld: null,
      refreshedAt: "2026-11-26T06:00:00Z",
      failure: over.failure ?? null,
    },
  ],
});

const mount = (onCount = vi.fn()) => {
  render(<PluginsTab onCount={onCount} />);
  return onCount;
};

describe("PluginsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.maintenanceInbox.mockResolvedValue(INBOX());
    api.applyLocation.mockResolvedValue({ undoId: "u1", rowId: "r1", written: {} });
    api.undoLocation.mockResolvedValue({ undoId: "u1", rowId: "r1", restored: {} });
  });

  it("reports proposals and notices as the tab's count", async () => {
    const onCount = mount();
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(2));
  });

  it("writes nothing without the confirmation, and cancelling writes nothing", async () => {
    mount();
    const card = (await screen.findAllByTestId("plugin-entry")).find((c) =>
      within(c).queryByRole("button", { name: "Bearbeiten" })
    )!;
    await userEvent.click(within(card).getByRole("button", { name: "Bearbeiten" }));
    await userEvent.click(screen.getByRole("button", { name: "Übernehmen …" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Wird ins Projektarchiv geschrieben (Projekte, Baustelle Nord):"
    );
    expect(api.applyLocation).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: /Abbrechen/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.applyLocation).not.toHaveBeenCalled();
  });

  it("sends exactly the edited values the dialog showed, then offers undo", async () => {
    mount();
    const card = (await screen.findAllByTestId("plugin-entry")).find((c) =>
      within(c).queryByRole("button", { name: "Bearbeiten" })
    )!;
    await userEvent.click(within(card).getByRole("button", { name: "Bearbeiten" }));
    await userEvent.click(screen.getByRole("button", { name: "map-pick" }));
    const street = screen.getByLabelText("Straße");
    await userEvent.clear(street);
    await userEvent.type(street, "Sendlinger Str. 5");
    await userEvent.click(screen.getByRole("button", { name: "Übernehmen …" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Koordinaten: 48.1, 11.5");
    expect(dialog).toHaveTextContent("Straße: Sendlinger Str. 5");
    expect(dialog).toHaveTextContent("PLZ bleibt: 80331");
    await userEvent.click(within(dialog).getByRole("button", { name: "Bestätigen" }));
    await waitFor(() =>
      expect(api.applyLocation).toHaveBeenCalledWith("p1", {
        rowId: "r1",
        lat: 48.1,
        lon: 11.5,
        street: "Sendlinger Str. 5",
        source: "manual",
      })
    );
    await userEvent.click(await screen.findByRole("button", { name: "Zurücknehmen" }));
    // Undo writes to the archive too: nothing until its own confirmation.
    const undoDialog = await screen.findByRole("dialog");
    expect(api.undoLocation).not.toHaveBeenCalled();
    await userEvent.click(within(undoDialog).getByRole("button", { name: "Zurücknehmen" }));
    await waitFor(() => expect(api.undoLocation).toHaveBeenCalledWith("p1", "u1"));
  });

  it("says why a write was refused", async () => {
    api.applyLocation.mockRejectedValue({ response: { data: { error: "readOnly" } } });
    mount();
    const card = (await screen.findAllByTestId("plugin-entry")).find((c) =>
      within(c).queryByRole("button", { name: "Bearbeiten" })
    )!;
    await userEvent.click(within(card).getByRole("button", { name: "Bearbeiten" }));
    await userEvent.click(screen.getByRole("button", { name: "Übernehmen …" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Bestätigen" })
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("opening the tab asks no plugin: it reads the server's copy", async () => {
    mount();
    await screen.findAllByTestId("plugin-entry");
    expect(api.maintenanceInbox).toHaveBeenCalledTimes(1);
    expect(api.maintenance).not.toHaveBeenCalled();
    expect(api.capabilities).not.toHaveBeenCalled();
    expect(api.refreshMaintenanceInbox).not.toHaveBeenCalled();
  });

  it("'Jetzt aktualisieren' asks live and says when it was refused by the rate limit", async () => {
    api.refreshMaintenanceInbox.mockRejectedValueOnce({ response: { status: 429, data: {} } });
    mount();
    await screen.findAllByTestId("plugin-entry");
    await userEvent.click(screen.getByRole("button", { name: "Jetzt aktualisieren" }));
    await waitFor(() => expect(api.refreshMaintenanceInbox).toHaveBeenCalledWith("de"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // The older copy stays on screen.
    expect(screen.getAllByTestId("plugin-entry").length).toBeGreaterThan(0);
  });

  it("names a plugin whose last refresh failed, next to its older answer", async () => {
    api.maintenanceInbox.mockResolvedValue(INBOX({ failure: "timeout" }));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Projekte:");
    expect(screen.getAllByTestId("plugin-entry")).toHaveLength(2);
  });

  it("a notice shows its reason and opens its row", async () => {
    mount();
    expect(await screen.findByText("Koordinaten liegen 4 km von der Adresse")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Zeile öffnen" }));
    expect(screen.getByLabelText("Straße")).toBeInTheDocument();
  });
});

describe("plugin entry sorting", () => {
  const rows: MaintenanceList["rows"] = [
    { rowId: "a", name: "A", issues: ["noStreet"], proposals: [] },
    {
      rowId: "b",
      name: "B",
      issues: ["noCoordinates"],
      proposals: [],
    },
    {
      rowId: "c",
      name: "C",
      issues: ["lowPrecision"],
      proposals: [
        {
          source: "stop",
          lat: 1,
          lon: 1,
          confidence: "low",
          evidence: { stopStart: "2026-11-25T00:00:00Z" },
        },
      ],
    },
  ];
  const entries = entriesOf(plugin, rows, []);
  const names = (by: "severity" | "date" | "stop") =>
    sortEntries(entries, by).map((e) => (e.kind === "row" ? e.row.name : ""));

  it("by severity puts a missing position first", () => expect(names("severity")[0]).toBe("B"));
  it("by date puts the newest stop first", () => expect(names("date")[0]).toBe("C"));
  it("by stop proposal puts rows with one first", () => expect(names("stop")[0]).toBe("C"));
  it("an ignored row is no entry", () =>
    expect(entriesOf(plugin, [{ ...rows[0], ignored: true }], [])).toHaveLength(0));
});
