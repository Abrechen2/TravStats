import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import EvidencePanel from "../EvidencePanel";
import { evidenceApi } from "../../../lib/api/evidence";
import type { EvidenceResponse } from "../../../shared/evidence";

afterEach(cleanup);

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
        omitted: { count: 0 },
      })
    );
    await userEvent.click(screen.getByRole("button", { name: "evidence:panel.loadMore" }));

    await screen.findByText("LH200");
    // The first page's row is still there — "load more" appends, it does not replace.
    expect(screen.getByText("LH100")).toBeInTheDocument();
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
