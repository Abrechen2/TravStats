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

  it("counts one item per archive row: a notice about the row folds into it", async () => {
    const onCount = mount();
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(1));
    expect(screen.getAllByTestId("plugin-entry")).toHaveLength(1);
  });

  it("badge counts only actionable items: geocoder-only rows and warning notices stay out", async () => {
    const data: MaintenanceList = {
      ...LIST,
      rows: [
        ...LIST.rows,
        ...Array.from({ length: 5 }, (_, i) => ({
          rowId: `g${i}`,
          name: `Ungenau ${i}`,
          issues: ["noStreet" as const, "lowPrecision" as const],
          proposals: [{ source: "geocoder" as const, lat: 1, lon: 1, confidence: "low" as const }],
        })),
      ],
      notices: [
        ...LIST.notices!,
        {
          severity: "warning",
          code: "ambiguousGeocoder",
          rowId: "g1",
          message: "Mehrdeutig",
        },
        { severity: "error", code: "readOnly", message: "Archiv ist schreibgeschützt" },
      ],
    };
    api.maintenanceInbox.mockResolvedValue(INBOX({ data }));
    const onCount = mount();
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(2));
    expect(screen.queryByText("Ungenau 1")).toBeNull();
    expect(screen.queryByText("Mehrdeutig")).toBeNull();
    expect(screen.getByText("Archiv ist schreibgeschützt")).toBeInTheDocument();
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
    expect(screen.getAllByTestId("plugin-entry")).toHaveLength(1);
  });

  it("a notice about a listed row shows its reason inside that row's item", async () => {
    mount();
    const notice = await screen.findByTestId("plugin-entry-notice");
    expect(notice).toHaveTextContent("Koordinaten liegen 4 km von der Adresse");
    const card = notice.closest("[data-testid='plugin-entry']") as HTMLElement;
    expect(within(card).getByText("Baustelle Nord")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Bearbeiten" }));
    expect(screen.getByLabelText("Straße")).toBeInTheDocument();
  });
});

describe("plugin entry sorting", () => {
  const rows: MaintenanceList["rows"] = [
    // In the inbox through its error notice alone, without a stop proposal.
    { rowId: "a", name: "A", issues: ["noStreet"], proposals: [] },
    {
      rowId: "b",
      name: "B",
      issues: ["noCoordinates"],
      proposals: [{ source: "stop", lat: 1, lon: 1, confidence: "low" }],
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
  const entries = entriesOf(plugin, rows, [
    { severity: "error", code: "readOnly", rowId: "a", message: "ro" },
  ]);
  const names = (by: "severity" | "date" | "stop") =>
    sortEntries(entries, by).map((e) => (e.kind === "row" ? e.row.name : ""));

  it("by severity puts the errors first and the merely imprecise row last", () =>
    expect(names("severity")).toEqual(["A", "B", "C"]));
  it("by date puts the newest stop first", () => expect(names("date")[0]).toBe("C"));
  it("by stop proposal puts the row without one last", () =>
    expect(names("stop").slice(-1)).toEqual(["A"]));
  it("an ignored row is no entry", () =>
    expect(entriesOf(plugin, [{ ...rows[2], ignored: true }], [])).toHaveLength(0));
});

describe("which plugin entries reach the inbox", () => {
  const geocoderOnly = {
    rowId: "x",
    name: "X",
    issues: ["lowPrecision" as const],
    proposals: [{ source: "geocoder" as const, lat: 1, lon: 1, confidence: "low" as const }],
  };
  const withStop = {
    rowId: "y",
    name: "Y",
    issues: ["noStreet" as const],
    proposals: [
      { source: "geocoder" as const, lat: 1, lon: 1, confidence: "low" as const },
      { source: "stop" as const, lat: 1.001, lon: 1, confidence: "high" as const },
    ],
  };

  it("an imprecise row without stop evidence is not in the inbox", () =>
    expect(entriesOf(plugin, [geocoderOnly], [])).toHaveLength(0));

  it("a row with a stop proposal appears once, carrying its geocoder proposal and notices", () => {
    const entries = entriesOf(
      plugin,
      [withStop],
      [
        { severity: "warning", code: "coordsMismatch", rowId: "y", message: "a" },
        { severity: "warning", code: "ambiguousGeocoder", rowId: "y", message: "b" },
      ]
    );
    expect(entries).toHaveLength(1);
    const [only] = entries;
    expect(only.kind === "row" && only.row.proposals).toHaveLength(2);
    expect(only.kind === "row" && only.notices.map((n) => n.code)).toEqual([
      "coordsMismatch",
      "ambiguousGeocoder",
    ]);
  });

  it("an error notice about an imprecise row makes that row one item, with the notice folded in", () => {
    const entries = entriesOf(
      plugin,
      [geocoderOnly],
      [{ severity: "error", code: "readOnly", rowId: "x", message: "ro" }]
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "row", severity: "error" });
  });

  it("an error notice twice for the same row off the page is one item; a warning one is none", () => {
    const entries = entriesOf(
      plugin,
      [],
      [
        { severity: "error", code: "readOnly", rowId: 7, message: "ro" },
        { severity: "error", code: "readOnly", rowId: "7", message: "ro" },
        { severity: "warning", code: "coordsMismatch", rowId: 8, message: "w" },
      ]
    );
    expect(entries.map((e) => e.key)).toEqual(["p1:notice:readOnly:7"]);
  });
});
