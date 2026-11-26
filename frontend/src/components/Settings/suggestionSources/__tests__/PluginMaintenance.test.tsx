import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../MaintenanceMap", () => ({
  default: ({ proposals }: { proposals: unknown[] }) => (
    <div data-testid="maintenance-map">{proposals.length} pins</div>
  ),
}));
const api = vi.hoisted(() => ({
  update: vi.fn(),
  test: vi.fn(),
  rotate: vi.fn(),
  backfill: vi.fn(),
  capabilities: vi.fn(),
  maintenance: vi.fn(),
  applyLocation: vi.fn(),
  undoLocation: vi.fn(),
  ignoreRow: vi.fn(),
}));
vi.mock("../../../../lib/api/suggestionPlugins", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/suggestionPlugins")>()),
  suggestionPluginsApi: api,
}));

import PluginCard from "../PluginCard";
import PluginMaintenanceDialog from "../PluginMaintenanceDialog";

/**
 * "Standorte pflegen" (owner 2026-11-24): shown only for a plugin that
 * announces the capability; the MSA row with its proposals; "Übernehmen" asks
 * first and names what is written; every failure is shown; undo is offered.
 */
const PLUGIN = {
  id: "p1",
  name: "Archiv",
  url: "http://plugin:8080/",
  precision: "exact" as const,
  enabled: true,
  backfillAllowed: false,
  secretSet: true,
  lastVersion: 1,
  lastOutcome: "ok",
  lastCalledAt: null,
  lastErrorAt: null,
  retryAt: null,
};

const LIST = {
  rows: [
    {
      rowId: "7",
      projNr: "P-7",
      name: "MSA Zentralküche Sonthofen",
      street: null,
      postcode: "87527",
      town: "Sonthofen",
      lat: 47.5055914,
      lon: 10.27527,
      issues: ["noStreet"],
      proposals: [
        {
          source: "stop",
          lat: 47.512,
          lon: 10.271,
          confidence: "high",
          evidence: {
            venueName: "MSA Menüservice Allgäu",
            stopStart: "2026-11-24T12:47:00Z",
            matchedTokens: ["msa"],
            distanceMeters: 782,
          },
        },
        {
          source: "geocoder",
          lat: 47.51195,
          lon: 10.27112,
          address: "Gewerbestr. 5, 87527 Sonthofen",
          street: "Gewerbestr. 5",
          confidence: "high",
          evidence: { label: "MSA Menüservice Allgäu" },
        },
      ],
    },
  ],
  applied: [
    {
      undoId: "u-1",
      rowId: "8",
      name: "Kurhaus",
      written: { Latitude: 47.4, Longitude: 10.28 },
      source: "manual",
      appliedAt: "2026-11-24T15:00:00Z",
    },
  ],
  pendingSearches: 0,
  stopsSent: 12,
  stopsWithheld: null,
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  api.maintenance.mockResolvedValue(LIST);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.values(api).forEach((f) => f.mockReset());
});

/** The confirm dialog's button: the last control with that name. */
const lastTake = () => {
  const all = screen.getAllByRole("button", { name: "suggestionSources:plugins.maintenance.take" });
  return all[all.length - 1];
};

const card = () =>
  render(<PluginCard plugin={PLUGIN} disabled={false} onChanged={() => {}} onRemove={() => {}} />);

describe("plugin location maintenance", () => {
  it("hides 'Standorte pflegen' for a plugin without the capability", async () => {
    api.capabilities.mockResolvedValue({ capabilities: [], maintenance: false, error: null });
    card();
    await waitFor(() => expect(api.capabilities).toHaveBeenCalledWith("p1", "de"));
    expect(screen.queryByText("suggestionSources:plugins.maintenance.open")).toBeNull();
  });

  it("shows it when the hello announces maintenance", async () => {
    api.capabilities.mockResolvedValue({
      capabilities: ["maintenance"],
      maintenance: true,
      error: null,
    });
    card();
    expect(await screen.findByText("suggestionSources:plugins.maintenance.open")).toBeTruthy();
  });

  it("shows a refused signature instead of silently hiding the page", async () => {
    api.capabilities.mockResolvedValue({ capabilities: [], maintenance: false, error: "auth" });
    card();
    const alert = await screen.findByText(/plugins\.maintenance\.helloFailed/);
    expect(alert.textContent).toContain("plugins.failure.reason.auth");
  });

  it("lists the MSA row with its stop and geocoder proposals", async () => {
    render(<PluginMaintenanceDialog plugin={PLUGIN} open onClose={() => {}} />);
    const row = await screen.findByTestId("maintenance-row");
    expect(within(row).getByText("MSA Zentralküche Sonthofen")).toBeTruthy();
    expect(within(row).getByText(/evidence\.stop.*MSA Menüservice Allgäu/)).toBeTruthy();
    expect(within(row).getByText("Gewerbestr. 5, 87527 Sonthofen")).toBeTruthy();
    expect(screen.getByTestId("maintenance-map").textContent).toBe("2 pins");
  });

  it("'Übernehmen' names exactly what is written and sends only that", async () => {
    api.applyLocation.mockResolvedValue({ undoId: "u-2", rowId: "7", written: {} });
    render(<PluginMaintenanceDialog plugin={PLUGIN} open onClose={() => {}} />);
    const row = await screen.findByTestId("maintenance-row");
    await userEvent.click(
      within(row).getAllByText("suggestionSources:plugins.maintenance.take")[1]
    );
    const dialog = await screen.findByText(/plugins\.maintenance\.confirm\.coords/);
    expect(dialog.textContent).toContain('"lat":"47.51195","lon":"10.27112"');
    expect(dialog.textContent).toContain('confirm.street{"street":"Gewerbestr. 5"}');
    expect(api.applyLocation).not.toHaveBeenCalled();
    await userEvent.click(lastTake());
    await waitFor(() =>
      expect(api.applyLocation).toHaveBeenCalledWith("p1", {
        rowId: "7",
        lat: 47.51195,
        lon: 10.27112,
        street: "Gewerbestr. 5",
        source: "geocoder",
      })
    );
  });

  it("shows a read-only archive as its own error", async () => {
    api.applyLocation.mockRejectedValue({
      response: { data: { error: "readOnly", code: "PLUGIN_FAILED" } },
    });
    render(<PluginMaintenanceDialog plugin={PLUGIN} open onClose={() => {}} />);
    const row = await screen.findByTestId("maintenance-row");
    await userEvent.click(
      within(row).getAllByText("suggestionSources:plugins.maintenance.take")[0]
    );
    await userEvent.click(lastTake());
    expect(
      await screen.findByText("suggestionSources:plugins.failure.reason.readOnly")
    ).toBeTruthy();
  });

  it("shows an unreachable plugin when the list fails", async () => {
    api.maintenance.mockRejectedValue({
      response: { data: { error: "unreachable", code: "PLUGIN_FAILED" } },
    });
    render(<PluginMaintenanceDialog plugin={PLUGIN} open onClose={() => {}} />);
    expect(
      await screen.findByText("suggestionSources:plugins.failure.reason.unreachable")
    ).toBeTruthy();
  });

  it("offers 'Rückgängig' on applied entries", async () => {
    api.undoLocation.mockResolvedValue({ undoId: "u-1", rowId: "8", restored: {} });
    render(<PluginMaintenanceDialog plugin={PLUGIN} open onClose={() => {}} />);
    const applied = await screen.findByTestId("maintenance-applied");
    await userEvent.click(within(applied).getByText("suggestionSources:plugins.maintenance.undo"));
    await waitFor(() => expect(api.undoLocation).toHaveBeenCalledWith("p1", "u-1"));
  });
  it("searches the plugin's whole list and pages through it, so a row past the first page is findable", async () => {
    api.maintenance.mockResolvedValue({ ...LIST, totalRows: 120, offset: 0 });
    render(<PluginMaintenanceDialog plugin={PLUGIN} open onClose={() => {}} />);
    await screen.findByTestId("maintenance-row");
    expect(api.maintenance).toHaveBeenLastCalledWith("p1", "de", { q: "", offset: 0, limit: 50 });
    await userEvent.click(screen.getByText("suggestionSources:plugins.maintenance.next"));
    await waitFor(() =>
      expect(api.maintenance).toHaveBeenLastCalledWith("p1", "de", { q: "", offset: 50, limit: 50 })
    );
    await userEvent.type(
      screen.getByLabelText("suggestionSources:plugins.maintenance.searchLabel"),
      "ragaz{Enter}"
    );
    await waitFor(() =>
      expect(api.maintenance).toHaveBeenLastCalledWith("p1", "de", {
        q: "ragaz",
        offset: 0,
        limit: 50,
      })
    );
  });

  it("shows a coordsMismatch row with the stop at the address as 'Dein Halt'", async () => {
    api.maintenance.mockResolvedValue({
      ...LIST,
      rows: [
        {
          rowId: "21",
          name: "Hotel Solaria, A-Ischgl",
          issues: ["coordsMismatch"],
          lat: 47.005,
          lon: 10.29,
          proposals: [
            {
              source: "stop",
              lat: 47.0145,
              lon: 10.2936,
              confidence: "high",
              evidence: {
                venueName: "Hotel Solaria",
                stopStart: "2026-11-26T07:38:00Z",
                stopEnd: "2026-11-26T10:01:00Z",
                matchedTokens: [],
                distanceMeters: 20,
              },
            },
          ],
        },
      ],
    });
    render(<PluginMaintenanceDialog plugin={PLUGIN} open onClose={() => {}} />);
    const row = await screen.findByTestId("maintenance-row");
    expect(row.textContent).toContain("plugins.maintenance.issue.coordsMismatch");
    expect(row.textContent).toContain("plugins.maintenance.evidence.stopHere");
    expect(row.textContent).toContain('"duration":"2 h 23 min"');
  });
});
