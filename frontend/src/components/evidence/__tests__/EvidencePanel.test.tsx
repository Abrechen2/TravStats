import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import EvidencePanel from "../EvidencePanel";
import { useEvidenceOpenStore } from "../evidenceOpenStore";
import { evidenceApi } from "../../../lib/api/evidence";
import type { EvidenceResponse } from "../../../shared/evidence";

afterEach(cleanup);
// Reset BEFORE each test, never after: the store is a module-level singleton,
// and resetting once `cleanup()` has already run risks notifying a listener
// mid-teardown instead of a clean slate for the next test.
beforeEach(() => useEvidenceOpenStore.setState({ scope: undefined, renderedValue: undefined }));

vi.mock("../../../lib/api/evidence", () => ({
  evidenceApi: { get: vi.fn() },
}));

/**
 * Same override as `EvidenceEntryRow.test.tsx`: the global mock drops every
 * option, which would hide whether the label's key AND its values actually
 * reached the screen. This keeps both visible.
 */
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (!options) return key;
      const { ns: _ns, keySeparator: _ks, ...values } = options;
      return Object.keys(values).length ? `${key}(${JSON.stringify(values)})` : key;
    },
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

function response(overrides: Partial<EvidenceResponse> = {}): EvidenceResponse {
  return {
    measure: {
      kind: "ranking",
      key: "airline:LH",
      aggregation: "sum",
      label: { key: "evidence.ranking.airline", values: { airline: "Lufthansa" } },
      unit: "flights",
      value: 42,
      scope: { period: { kind: "allTime" } },
    },
    entries: [],
    returned: 0,
    omitted: { count: 0 },
    unattributed: [],
    page: { offset: 0, limit: 100 },
    ...overrides,
  };
}

function renderPanel(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <EvidencePanel />
    </MemoryRouter>
  );
}

describe("EvidencePanel", () => {
  it("renders nothing without an `evidence` param", () => {
    renderPanel(["/stats"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(evidenceApi.get).not.toHaveBeenCalled();
  });

  it("shows the label composed from its key and values, and the measured value", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValue(response());
    renderPanel(["/stats?evidence=ranking%3Aairline%3ALH"]);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName('evidence.ranking.airline({"airline":"Lufthansa"})');
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  /**
   * "The number may have moved since the tile rendered" (design). Before
   * Task 9 there was no channel for a tile's own value to reach the panel at
   * all, so this invariant was trivially true and proved nothing — these two
   * tests exercise the real channel: `evidenceOpenStore` holds the figure a
   * tile had on screen when it called `open()` (`useEvidenceOpen`, tested on
   * its own in `useEvidence.test.tsx`), and `EvidencePanel` compares it
   * against the measure it just fetched. Priming the store directly and then
   * mounting on an already-open URL — rather than clicking a trigger — tests
   * that comparison in isolation, without a second async boundary (the click
   * → store write → router navigation → re-render chain) between the
   * assertion and the thing it is checking.
   */
  it("says the figure was recomputed when the opening tile's value disagrees with the fresh one", async () => {
    useEvidenceOpenStore.setState({ scope: undefined, renderedValue: 40 });
    vi.mocked(evidenceApi.get).mockResolvedValue(response());
    renderPanel(["/stats?evidence=ranking%3Aairline%3ALH"]);

    // Waits for the fetch to settle, not just for the dialog shell to mount —
    // the shell renders before `evidenceApi.get` resolves.
    await screen.findByText("42");

    // The measured value (42) and the tile's own value (40) both appear —
    // never a wording that only gives one side of the disagreement.
    expect(
      screen.getByText('evidence:panel.recomputed({"previous":"40","current":"42"})')
    ).toBeInTheDocument();
  });

  it("says nothing when the opening tile's value agrees with the fresh one", async () => {
    useEvidenceOpenStore.setState({ scope: undefined, renderedValue: 42 });
    vi.mocked(evidenceApi.get).mockResolvedValue(response());
    renderPanel(["/stats?evidence=ranking%3Aairline%3ALH"]);

    await screen.findByText("42");

    expect(screen.queryByText(/panel\.recomputed/)).not.toBeInTheDocument();
  });

  it("says nothing for a bookmark or a raw `?evidence=` link — no rendered value is known", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValue(response());
    renderPanel(["/stats?evidence=ranking%3Aairline%3ALH"]);

    await screen.findByText("42");

    expect(screen.queryByText(/panel\.recomputed/)).not.toBeInTheDocument();
  });

  it("renders the abstention line for a `null` value — never '0'", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValue(
      response({
        measure: {
          kind: "metric",
          key: "businessTotalCost",
          aggregation: "sum",
          label: { key: "evidence.metric.businessTotalCost" },
          unit: "currency",
          value: null,
          scope: { period: { kind: "allTime" } },
        },
        unattributed: [{ count: 5, reason: "notPerEntry" }],
      })
    );
    renderPanel(["/stats?evidence=metric%3AbusinessTotalCost"]);

    await screen.findByRole("dialog");
    expect(screen.getByText("evidence:panel.abstention")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders the unattributed reason when the response names one", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValue(
      response({ unattributed: [{ count: 3, reason: "locationHistoryOnly" }] })
    );
    renderPanel(["/stats?evidence=ranking%3Aairline%3ALH"]);

    await screen.findByRole("dialog");
    expect(
      screen.getByText('evidence:panel.bucket.unattributedLocationHistoryOnly({"count":3})')
    ).toBeInTheDocument();
  });

  it("renders no gap line at all when `unattributed` is empty", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValue(response({ unattributed: [] }));
    renderPanel(["/stats?evidence=ranking%3Aairline%3ALH"]);

    await screen.findByRole("dialog");
    expect(screen.queryByText(/unattributed/)).not.toBeInTheDocument();
  });

  it("'load more' APPENDS the second page rather than replacing the first", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValueOnce(
      response({
        entries: [
          {
            domain: "flight",
            id: "f1",
            href: "/flights/f1",
            title: { text: "LH100" },
            subtitle: null,
            date: null,
            contribution: 1,
          },
        ],
        returned: 1,
        omitted: { count: 1 },
      })
    );
    renderPanel(["/stats?evidence=ranking%3Aairline%3ALH"]);
    await screen.findByText("LH100");

    vi.mocked(evidenceApi.get).mockResolvedValueOnce(
      response({
        entries: [
          {
            domain: "flight",
            id: "f2",
            href: "/flights/f2",
            title: { text: "LH200" },
            subtitle: null,
            date: null,
            contribution: 1,
          },
        ],
        returned: 1,
        // The second page of a two-row measure: `omitted.count` is every
        // known row NOT on this page, so it is 1 (the row page one showed),
        // not 0. The fixture said 0 before, which is a response no resolver
        // can produce — it made the panel look right while the real shape
        // kept "load more" on screen forever.
        omitted: { count: 1 },
        page: { offset: 1, limit: 100 },
      })
    );
    await userEvent.click(screen.getByRole("button", { name: "evidence:panel.loadMore" }));

    await screen.findByText("LH200");
    // The first page's row is still there — "load more" appends, it does not replace.
    expect(screen.getByText("LH100")).toBeInTheDocument();
    // Both rows are in hand, so nothing is left to fetch.
    expect(
      screen.queryByRole("button", { name: "evidence:panel.loadMore" })
    ).not.toBeInTheDocument();
  });

  /**
   * The paging arithmetic. `omitted.count` is every known row absent from
   * THIS page — before or after it — so reading it as "rows ahead" left the
   * button on screen on the last page and printed a count that included what
   * the reader was already looking at. Three resolver-shaped pages, asserted
   * at both ends.
   *
   * 25 rows in pages of 10, not the 250-in-100s that exposed the bug in the
   * field: the arithmetic is identical and the fixture renders 750 list rows
   * fewer. `useEvidence.test.tsx` keeps the full-size case, where it costs no
   * DOM at all.
   */
  it("counts down the 'not loaded yet' line and drops 'load more' on the last of three pages", async () => {
    const row = (n: number) => ({
      domain: "flight" as const,
      id: `f${n}`,
      href: `/flights/f${n}`,
      title: { text: `LH${n}` },
      subtitle: null,
      date: null,
      contribution: 1,
    });
    const pageOf = (offset: number, size: number) =>
      response({
        measure: {
          kind: "metric",
          key: "flightCount",
          aggregation: "sum",
          label: { key: "evidence.metric.flightCount" },
          unit: "flights",
          value: 25,
          scope: { period: { kind: "allTime" } },
        },
        entries: Array.from({ length: size }, (_, i) => row(offset + i)),
        returned: size,
        omitted: { count: 25 - size, contribution: 25 - size },
        page: { offset, limit: 10 },
      });

    vi.mocked(evidenceApi.get)
      .mockResolvedValueOnce(pageOf(0, 10))
      .mockResolvedValueOnce(pageOf(10, 10))
      .mockResolvedValueOnce(pageOf(20, 5));

    renderPanel(["/stats?evidence=metric%3AflightCount"]);
    await screen.findByText("LH0");

    // 25 known, 10 in hand: 15 still to come — which happens to equal the raw
    // `omitted.count` on page one, so the pages below are the real assertion.
    expect(screen.getByText('evidence:panel.bucket.omitted({"count":15})')).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "evidence:panel.loadMore" }));
    await screen.findByText("LH10");
    // 20 in hand of 25: 5 left, although `omitted.count` still says 15.
    expect(screen.getByText('evidence:panel.bucket.omitted({"count":5})')).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "evidence:panel.loadMore" }));
    await screen.findByText("LH20");
    expect(screen.queryByText(/panel\.bucket\.omitted/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "evidence:panel.loadMore" })
    ).not.toBeInTheDocument();
  });

  it("Escape closes the panel and returns focus to whatever opened it", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValue(response());

    function OpenButton() {
      const [, setSearchParams] = useSearchParams();
      return (
        <button onClick={() => setSearchParams({ evidence: "ranking:airline:LH" })}>Öffnen</button>
      );
    }

    render(
      <MemoryRouter initialEntries={["/stats"]}>
        <OpenButton />
        <EvidencePanel />
      </MemoryRouter>
    );

    const opener = screen.getByRole("button", { name: "Öffnen" });
    await userEvent.click(opener);
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
  });
});
