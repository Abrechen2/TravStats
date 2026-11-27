/**
 * Place lists as a table (owner 2026-11-26): server sort and paging, the row is the link, visit
 * dates on expand, plugin columns, failures said; the smart rule is editable from the list; the
 * purpose segment writes the URL; the plugin list switch says when it fails.
 */
import { useState, type JSX } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ListMemberRow, ListMembersPage } from "../../../../types/placeList";

const getListMembers = vi.fn();
vi.mock("../../../../lib/api/placeLists", () => ({
  getListMembers: (...a: unknown[]) => getListMembers(...a),
}));
const getListRule = vi.fn();
const saveListRule = vi.fn();
const clearListRule = vi.fn();
vi.mock("../../../../lib/api/smartLists", async (orig) => ({
  ...(await orig<typeof import("../../../../lib/api/smartLists")>()),
  getListRule: (...a: unknown[]) => getListRule(...a),
  saveListRule: (...a: unknown[]) => saveListRule(...a),
  clearListRule: (...a: unknown[]) => clearListRule(...a),
  listNewOutlets: vi.fn(async () => []),
  listAutoAccepted: vi.fn(async () => []),
  listPendingConfirmations: vi.fn(async () => ({ rows: [], total: 0 })),
}));
const setList = vi.fn();
vi.mock("../../../../lib/api/suggestionPlugins", async (orig) => ({
  ...(await orig<typeof import("../../../../lib/api/suggestionPlugins")>()),
  suggestionPluginsApi: { setList: (...a: unknown[]) => setList(...a) },
}));
vi.mock("../../../../lib/api/purpose", () => ({ purposeApi: { usage: vi.fn(async () => ({})) } }));
vi.mock("../../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

import PlaceListTable from "../PlaceListTable";
import SmartListPanel from "../../smartList/SmartListPanel";
import PurposeSegment from "../../../purpose/PurposeSegment";
import PluginListSwitch from "../../../Settings/suggestionSources/PluginListSwitch";

const row = (over: Partial<ListMemberRow>): ListMemberRow => ({
  entryId: "e1",
  placeId: "p1",
  name: "Berlin Mitte",
  category: "restaurant",
  country: "Deutschland",
  countryCode: "DE",
  city: "Berlin",
  visitCount: 2,
  firstVisit: "2024-01-05",
  lastVisit: "2025-03-01",
  addedAt: "2026-01-01T00:00:00.000Z",
  sortIdx: 0,
  source: "manual",
  distanceKm: null,
  external: null,
  visits: [
    { id: "v2", date: "2025-03-01" },
    { id: "v1", date: "2024-01-05" },
  ],
  ...over,
});
const page = (over: Partial<ListMembersPage> = {}): ListMembersPage => ({
  rows: [row({})],
  total: 1,
  page: 1,
  pageSize: 50,
  columns: [],
  hasHome: false,
  ...over,
});

function Where(): JSX.Element {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search + loc.hash}</output>;
}

const renderTable = (initial = "/places/lists/l1") =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <PlaceListTable
                listId="l1"
                refreshKey={1}
                iconOf={() => "•"}
                onRemove={vi.fn()}
                onMove={vi.fn(async () => {})}
              />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );

describe("PlaceListTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getListMembers.mockResolvedValue(page());
  });

  it("asks the server for the last visit first, newest first", async () => {
    renderTable();
    await screen.findByText("Berlin Mitte");
    expect(getListMembers).toHaveBeenCalledWith("l1", {
      sort: "lastVisit",
      order: "desc",
      page: 1,
      pageSize: 50,
      q: "",
    });
  });

  it("a header click sorts ascending, a second descending; the choice is in the URL and remembered per list", async () => {
    renderTable();
    await screen.findByText("Berlin Mitte");
    await userEvent.click(screen.getByRole("button", { name: "Nach Name sortieren" }));
    await waitFor(() =>
      expect(getListMembers).toHaveBeenLastCalledWith(
        "l1",
        expect.objectContaining({ sort: "name", order: "asc" })
      )
    );
    expect(screen.getByTestId("where").textContent).toContain("sort=name&order=asc");
    await userEvent.click(screen.getByRole("button", { name: "Nach Name sortieren" }));
    await waitFor(() =>
      expect(getListMembers).toHaveBeenLastCalledWith(
        "l1",
        expect.objectContaining({ sort: "name", order: "desc" })
      )
    );
    expect(JSON.parse(localStorage.getItem("travstats:place-list-sort:l1")!)).toEqual({
      sort: "name",
      order: "desc",
    });
  });

  it("the sort select offers every key, own order included", async () => {
    renderTable();
    await screen.findByText("Berlin Mitte");
    const select = screen.getByTestId("place-list-sort");
    const values = within(select)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual([
      "lastVisit",
      "name",
      "country",
      "visitCount",
      "firstVisit",
      "addedAt",
      "custom",
    ]);
    await userEvent.selectOptions(select, "visitCount");
    await waitFor(() =>
      expect(getListMembers).toHaveBeenLastCalledWith(
        "l1",
        expect.objectContaining({ sort: "visitCount", order: "desc" })
      )
    );
  });

  it("a stored sort for this list is used when the URL names none", async () => {
    localStorage.setItem(
      "travstats:place-list-sort:l1",
      JSON.stringify({ sort: "country", order: "asc" })
    );
    renderTable();
    await screen.findByText("Berlin Mitte");
    expect(getListMembers).toHaveBeenCalledWith(
      "l1",
      expect.objectContaining({ sort: "country", order: "asc" })
    );
  });

  it("clicking the row opens the place; the name is the keyboard link", async () => {
    renderTable();
    const link = await screen.findByRole("link", { name: "Berlin Mitte" });
    expect(link.getAttribute("href")).toBe("/places/p1");
    await userEvent.click(screen.getByText("Berlin"));
    expect(screen.getByTestId("where").textContent).toBe("/places/p1");
  });

  it("the visits column shows the count and, expanded, each date linking to its visit", async () => {
    renderTable();
    const toggle = await screen.findByTestId("place-list-visits");
    expect(toggle.textContent).toContain("2");
    await userEvent.click(toggle);
    const dates = screen.getByTestId("place-list-visit-dates");
    const links = within(dates).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("/places/p1#visit-v2");
    // Expanding does not navigate.
    expect(screen.getByTestId("where").textContent).toBe("/places/lists/l1");
  });

  it("shows the source, the distance when there is a home, and a plugin's columns", async () => {
    getListMembers.mockResolvedValue(
      page({
        hasHome: true,
        columns: [{ key: "colA", label: { de: "Nr.", en: "No." } }],
        rows: [
          row({
            source: "plugin",
            distanceKm: 12.5,
            external: { id: "4711", fields: { colA: "4711" } },
          }),
        ],
      })
    );
    renderTable();
    await screen.findByText("Berlin Mitte");
    expect(screen.getByRole("columnheader", { name: "Nr." })).toBeTruthy();
    expect(screen.getByText("4711")).toBeTruthy();
    expect(screen.getByText("Plugin")).toBeTruthy();
    expect(screen.getByText("12,5 km")).toBeTruthy();
  });

  it("pages on the server", async () => {
    getListMembers.mockResolvedValue(page({ total: 120 }));
    renderTable();
    await screen.findByText("Berlin Mitte");
    await userEvent.click(screen.getAllByRole("button", { name: /nächste|weiter|next/i })[0]);
    await waitFor(() =>
      expect(getListMembers).toHaveBeenLastCalledWith("l1", expect.objectContaining({ page: 2 }))
    );
  });

  it("a slower answer to an older sort does not overwrite the newer one", async () => {
    let releaseOld: (v: ListMembersPage) => void = () => {};
    getListMembers
      .mockImplementationOnce(() => new Promise<ListMembersPage>((r) => (releaseOld = r)))
      .mockResolvedValue(page({ rows: [row({ name: "Neu" })] }));
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Nach Name sortieren" }));
    await screen.findByText("Neu");
    releaseOld(page({ rows: [row({ name: "Alt" })] }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Alt")).toBeNull();
    expect(screen.getByText("Neu")).toBeTruthy();
  });

  it("says when the places could not be loaded, and retries", async () => {
    getListMembers.mockRejectedValueOnce(new Error("boom"));
    renderTable();
    expect((await screen.findByRole("alert")).textContent).toContain("Orte nicht geladen.");
    await userEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await screen.findByText("Berlin Mitte");
  });

  it("offers up/down only in own order, with touch-sized controls on a coarse pointer", async () => {
    renderTable("/places/lists/l1?sort=custom&order=asc");
    await screen.findByText("Berlin Mitte");
    const up = screen.getByRole("button", { name: "„Berlin Mitte“ nach oben schieben" });
    // jsdom cannot measure; the pointer-scoped class is the contract.
    expect(up.className).toContain("pointer-coarse:min-h-(--ts-size-touch-min)");
    expect(
      screen.getByRole("button", { name: "„Berlin Mitte“ aus der Liste entfernen" }).className
    ).toContain("pointer-coarse:min-w-(--ts-size-touch-min)");
  });

  it("offers no up/down outside own order", async () => {
    renderTable();
    await screen.findByText("Berlin Mitte");
    expect(screen.queryByRole("button", { name: /nach oben schieben/ })).toBeNull();
  });
});

describe("editing a smart list's rule", () => {
  const rule = {
    listId: "l1",
    brands: [{ brandWikidataId: "Q38076", brandName: "McDonald's" }],
    minDwellMinutes: 5,
    maxDwellMinutes: 60,
    maxDistanceM: 100,
    autoAcceptDistanceM: 60,
    autoAccept: false,
  };

  function Harness(): JSX.Element {
    const [open, setOpen] = useState(false);
    const [hasRule, setHasRule] = useState(false);
    return (
      <>
        <output data-testid="has-rule">{String(hasRule)}</output>
        <SmartListPanel
          listId="l1"
          ruleOpen={open}
          onRuleClose={() => setOpen(false)}
          onChanged={vi.fn()}
          onRuleLoaded={setHasRule}
          onEditRule={() => setOpen(true)}
        />
      </>
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getListRule.mockResolvedValue(rule);
  });

  it("the pencil opens the rule with all its settings, and a change is saved (round trip)", async () => {
    saveListRule.mockImplementation(async (_id: string, input: object) => ({ ...rule, ...input }));
    render(<Harness />);
    await userEvent.click(await screen.findByRole("button", { name: "Regel bearbeiten" }));
    expect(screen.getByTestId("has-rule").textContent).toBe("true");
    const max = screen.getByLabelText("Höchstdauer (Min.)") as HTMLInputElement;
    expect(max.value).toBe("60");
    expect((screen.getByLabelText("Automatisch bis (m)") as HTMLInputElement).value).toBe("60");
    expect(screen.getByRole("button", { name: "McDonald's entfernen" })).toBeTruthy();
    await userEvent.clear(max);
    await userEvent.type(max, "90");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(saveListRule).toHaveBeenCalledWith(
        "l1",
        expect.objectContaining({ maxDwellMinutes: 90, brands: rule.brands })
      )
    );
  });

  it("'Regel entfernen' clears the rule and the list says it has none", async () => {
    clearListRule.mockResolvedValue(undefined);
    render(<Harness />);
    await userEvent.click(await screen.findByRole("button", { name: "Regel bearbeiten" }));
    getListRule.mockResolvedValue(null);
    await userEvent.click(screen.getByRole("button", { name: "Regel entfernen" }));
    await waitFor(() => expect(clearListRule).toHaveBeenCalledWith("l1"));
    await waitFor(() => expect(screen.getByTestId("has-rule").textContent).toBe("false"));
  });
});

describe("PurposeSegment", () => {
  it("Geschäftlich narrows the page through the URL, Alle clears it", async () => {
    render(
      <MemoryRouter initialEntries={["/places/lists/l1"]}>
        <PurposeSegment />
        <Where />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole("button", { name: "Geschäftlich" }));
    expect(screen.getByTestId("where").textContent).toContain("purpose=business");
    expect(screen.getByRole("button", { name: "Geschäftlich" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    await userEvent.click(screen.getByRole("button", { name: "Alle" }));
    expect(screen.getByTestId("where").textContent).not.toContain("purpose=");
  });
});

describe("PluginListSwitch", () => {
  const state = { enabled: false, announced: true, listId: null, listName: null };

  it("switching on hands back the new list", async () => {
    const onChange = vi.fn();
    setList.mockResolvedValue({ enabled: true, announced: true, listId: "l9", listName: "X" });
    render(
      <MemoryRouter>
        <PluginListSwitch pluginId="p1" state={state} disabled={false} onChange={onChange} />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ listId: "l9" }))
    );
    expect(setList).toHaveBeenCalledWith("p1", true, "de");
  });

  it("says when the switch failed", async () => {
    setList.mockRejectedValue({ response: { status: 500, data: {} } });
    render(
      <MemoryRouter>
        <PluginListSwitch pluginId="p1" state={state} disabled={false} onChange={vi.fn()} />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole("switch"));
    expect((await screen.findByRole("alert")).textContent).toContain("Liste nicht umgeschaltet");
  });
});
