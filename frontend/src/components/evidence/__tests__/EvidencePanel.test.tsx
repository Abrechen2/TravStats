import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JSX } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import EvidencePanel from "../EvidencePanel";
import { useEvidenceOpenStore } from "../evidenceOpenStore";
import { evidenceApi } from "../../../lib/api/evidence";
import { logger } from "../../../lib/logger";
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
    // …and the footer counts the LIST, not the last page. Rendering
    // `response.returned` here printed "1 angezeigt" under two visible rows —
    // on the demo account, "33 angezeigt" under 133 (browser pass, 2026-09-19).
    expect(screen.getByText('evidence:panel.bucket.returned({"count":2})')).toBeInTheDocument();
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
    // All 25 rows are on screen; the last page returned 5. The footer says 25.
    expect(screen.getByText('evidence:panel.bucket.returned({"count":25})')).toBeInTheDocument();
    expect(screen.queryByText(/panel\.bucket\.omitted/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "evidence:panel.loadMore" })
    ).not.toBeInTheDocument();
  });

  /**
   * The header must not contradict the only line under it. All three of these
   * were reachable in the browser on 2026-09-19 and all three read "Beleg wird
   * geladen …" over "Die Belege konnten nicht geladen werden.", because the
   * title branched on the measure alone and a failed fetch has none.
   *
   * The statuses are the real ones the endpoint answers — 501 for a release-2
   * kind, 404 for a key it does not serve, 400 for a scope a resolver refuses
   * — rather than one generic rejection, because it is the URL shapes that
   * were observed, not a single code path.
   */
  it.each([
    ["achievement, not served until release 2", "achievement%3Ax", 501],
    ["a ranking key the server does not serve", "ranking%3Aairline%3A", 404],
    ["a measure whose scope is refused", "metric%3AplaceListCount", 400],
  ])("the title stops saying 'loading' once %s fails", async (_case, param, status) => {
    // `logger.error` shouts into the run for any non-404; the panel's own
    // behaviour is what is under test, not its logging.
    const logged = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.mocked(evidenceApi.get).mockRejectedValue(
      new AxiosError("failed", undefined, undefined, undefined, {
        status,
        data: {},
        statusText: "",
        headers: {},
        config: { headers: new AxiosHeaders() },
      })
    );

    renderPanel([`/stats?evidence=${param}`]);

    await screen.findByText("evidence:panel.loadError");
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("evidence:panel.errorTitle");
    logged.mockRestore();
  });

  /**
   * A browser probe on 2026-09-19 still counted a `[role=dialog]` after Escape
   * on the 404 error panel, which would have meant the error state closed by a
   * different contract from the loaded one. It does not: `Modal` is mounted on
   * `isOpen` and `useDialogChrome` keys Escape off the same flag, so the state
   * of the FETCH never reaches the keyboard. This pins that, and the probe's
   * reading is recorded as an artefact in the task report.
   */
  it("Escape closes the panel from the ERROR state too, and drops `?evidence`", async () => {
    const logged = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.mocked(evidenceApi.get).mockRejectedValue(
      new AxiosError("not found", undefined, undefined, undefined, {
        status: 404,
        data: {},
        statusText: "",
        headers: {},
        config: { headers: new AxiosHeaders() },
      })
    );

    function ParamProbe() {
      const [params] = useSearchParams();
      return <span data-testid="param">{params.get("evidence") ?? "none"}</span>;
    }

    render(
      <MemoryRouter initialEntries={["/stats?evidence=ranking%3Aairline%3A"]}>
        <ParamProbe />
        <EvidencePanel />
      </MemoryRouter>
    );

    await screen.findByText("evidence:panel.loadError");
    expect(screen.getByTestId("param")).toHaveTextContent("ranking:airline:");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("param")).toHaveTextContent("none");
    logged.mockRestore();
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

/**
 * Auditor 3, 2026-09-19: `?evidence=<kind>:<key>` exists so a link to the
 * panel can be shared -- "A shared link opens the panel" is the reason
 * `useEvidence.ts` gives for putting the state in the URL at all -- and
 * nothing on screen said so. A share mechanism nobody is told about is not
 * one.
 */
describe("EvidencePanel: sharing the panel", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("copies the address of the panel the reader is looking at", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValue(response());
    renderPanel(["/stats?evidence=ranking%3Aairline%3ALH"]);
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByRole("button", { name: "evidence:panel.copyLink" }));

    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByText("evidence:panel.copied")).toBeInTheDocument();
  });

  it("says so when the copy fails instead of claiming it worked", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    // The legacy fallback in `lib/clipboard` also has to fail for the promise
    // to reject -- jsdom has no `execCommand`, so it does.
    vi.mocked(evidenceApi.get).mockResolvedValue(response());
    renderPanel(["/stats?evidence=ranking%3Aairline%3ALH"]);
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByRole("button", { name: "evidence:panel.copyLink" }));

    expect(await screen.findByText("evidence:panel.copyFailed")).toBeInTheDocument();
  });
});

/**
 * Review, 2026-09-19: "Kopiert" belongs to one copy, of one address. The
 * panel is a singleton every tile reuses, so the confirmation stayed put --
 * a reader who closed it and opened a different measure was told a link they
 * never copied was on their clipboard.
 */
/**
 * The panel plus the three things a reader can do around it: open another
 * measure, close it, open it again. All through `?evidence=`, because that is
 * where the panel's open state actually lives.
 */
function PanelWithSwitch(): JSX.Element {
  const [, setSearchParams] = useSearchParams();
  return (
    <>
      <button
        data-testid="switch-measure"
        onClick={() => setSearchParams({ evidence: "metric:flightCount" })}
      >
        switch
      </button>
      <button data-testid="close-panel" onClick={() => setSearchParams({})}>
        close
      </button>
      <button
        data-testid="reopen-panel"
        onClick={() => setSearchParams({ evidence: "ranking:airline:LH" })}
      >
        reopen
      </button>
      <EvidencePanel />
    </>
  );
}

describe("EvidencePanel: the copy confirmation is about one visit", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("is gone again on the next measure", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValue(response());
    const view = render(
      <MemoryRouter initialEntries={["/stats?evidence=ranking%3Aairline%3ALH"]}>
        <PanelWithSwitch />
      </MemoryRouter>
    );
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByRole("button", { name: "evidence:panel.copyLink" }));
    expect(await screen.findByText("evidence:panel.copied")).toBeInTheDocument();

    // Same panel, different measure — what the reader reaches by clicking a
    // second tile without closing anything.
    await userEvent.click(screen.getByTestId("switch-measure"));

    expect(await screen.findByText("evidence:panel.copyLink")).toBeInTheDocument();
    expect(screen.queryByText("evidence:panel.copied")).not.toBeInTheDocument();
    view.unmount();
  });

  it("is gone again after the panel has been closed and reopened", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValue(response());
    render(
      <MemoryRouter initialEntries={["/stats?evidence=ranking%3Aairline%3ALH"]}>
        <PanelWithSwitch />
      </MemoryRouter>
    );
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByRole("button", { name: "evidence:panel.copyLink" }));
    expect(await screen.findByText("evidence:panel.copied")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("close-panel"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("reopen-panel"));

    expect(await screen.findByText("evidence:panel.copyLink")).toBeInTheDocument();
    expect(screen.queryByText("evidence:panel.copied")).not.toBeInTheDocument();
  });
});
