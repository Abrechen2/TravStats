import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";

import BulkLinkPanel from "../BulkLinkPanel";
import type { BulkPair, LinkPreview } from "../../../types/sharingLink";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

/**
 * "Alle passenden Reisen verknüpfen" (UAT 2026-11-27): a summary before the run, the automatic
 * pairs linked with the quality rule, the conflicts listed for review, a rate limit shown as a
 * pause (not a failure), a result and an undo per pair.
 */
const trip = (id: string, name: string, day: string) => ({
  id,
  name,
  startDay: day,
  endDay: day,
});
const pair = (id: string, extra: Partial<BulkPair> = {}): BulkPair => ({
  id,
  trip: trip(id, `Mine ${id}`, "2030-01-01"),
  other: trip(`o-${id}`, `Theirs ${id}`, "2030-01-01"),
  reason: "period",
  linked: false,
  ambiguous: false,
  ...extra,
});
const preview = (automatic: boolean): LinkPreview => ({
  access: "full",
  here: trip("x", "x", "2030-01-01"),
  there: trip("y", "y", "2030-01-01"),
  counts: { matched: 1, onlyHere: 0, onlyThere: 0, conflicting: 1, needsReview: automatic ? 0 : 1 },
  automatic,
  byType: [],
  matched: [],
  onlyHere: [],
  onlyThere: [],
});
const result = {
  groupId: "g",
  linked: 2,
  alreadyLinked: 0,
  skipped: 0,
  settled: 1,
  onlyHere: 0,
  onlyThere: 0,
  settleFailed: false,
};

function rateLimited(): AxiosError {
  const headers = new AxiosHeaders({ "retry-after": "0.01" });
  return new AxiosError("429", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 429,
    statusText: "Too Many Requests",
    headers,
    config: { headers },
    data: {},
  });
}

function setup() {
  const props = {
    otherName: "Papa",
    loadPairs: vi.fn().mockResolvedValue({
      access: "full",
      pairs: [pair("a"), pair("b"), pair("c", { ambiguous: true })],
    }),
    preview: vi.fn((p: BulkPair) => Promise.resolve(preview(p.id === "a"))),
    link: vi.fn().mockRejectedValueOnce(rateLimited()).mockResolvedValue(result),
    undo: vi.fn().mockResolvedValue(undefined),
    failure: vi.fn((_e: unknown, key: string) => ({ key })),
  };
  render(<BulkLinkPanel {...props} />);
  return props;
}

describe("BulkLinkPanel (UAT 2026-11-27)", () => {
  it("summarises first, links the automatic pair with the quality rule, lists the rest for review", async () => {
    const props = setup();
    const summary = await screen.findByTestId("bulk-summary");
    expect(summary.textContent).toContain('"auto":1');
    expect(summary.textContent).toContain('"review":2');
    // The ambiguous pair is never compared by guess.
    expect(props.preview).toHaveBeenCalledTimes(2);
    expect(props.link).not.toHaveBeenCalled();
    expect(screen.getByTestId("bulk-review").textContent).toContain("sharing:bulk.review.conflict");
    expect(screen.getByTestId("bulk-review").textContent).toContain(
      "sharing:bulk.review.ambiguous"
    );

    fireEvent.click(screen.getByRole("button", { name: /sharing:bulk.run/ }));
    // A 429 pauses with the minutes left, then the same pair goes through.
    expect(await screen.findByText(/sharing:bulk.paused/)).toBeInTheDocument();
    await waitFor(() => expect(props.link).toHaveBeenCalledTimes(2));
    expect(props.link).toHaveBeenLastCalledWith(expect.objectContaining({ id: "a" }), "best", {});
    const results = await screen.findByTestId("bulk-results");
    expect(results.textContent).toContain("sharing:bulk.state.done");
    expect(results.textContent).not.toContain("sharing:bulk.state.failed");

    const undo = screen.getByRole("button", { name: "sharing:bulk.undo" });
    await waitFor(() => expect(undo).not.toBeDisabled());
    fireEvent.click(undo);
    await waitFor(() =>
      expect(props.undo).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }))
    );
    expect(await screen.findByText(/sharing:bulk.state.undone/)).toBeInTheDocument();
  });

  it("before consent shows only the waiting sentence", async () => {
    render(
      <BulkLinkPanel
        otherName="Papa"
        loadPairs={vi.fn().mockResolvedValue({ access: "awaitingConsent" })}
        preview={vi.fn()}
        link={vi.fn()}
        undo={vi.fn()}
        failure={(_e, key) => ({ key })}
      />
    );
    expect(await screen.findByTestId("bulk-awaiting-consent")).toBeInTheDocument();
    expect(screen.queryByTestId("bulk-summary")).toBeNull();
  });
});

describe("BulkLinkPanel under React Strict Mode", () => {
  it("still compares after the effect ran twice (Copilot review)", async () => {
    const { StrictMode } = await import("react");
    const previewFn = vi.fn().mockResolvedValue(preview(true));
    render(
      <StrictMode>
        <BulkLinkPanel
          otherName="Papa"
          loadPairs={vi.fn().mockResolvedValue({ access: "full", pairs: [pair("a")] })}
          preview={previewFn}
          link={vi.fn()}
          undo={vi.fn()}
          failure={(_e, key) => ({ key })}
        />
      </StrictMode>
    );
    expect(await screen.findByTestId("bulk-summary")).toBeInTheDocument();
    expect(previewFn).toHaveBeenCalled();
  });
});

describe("BulkLinkPanel with a peer on an old server (coordinator follow-up)", () => {
  it("names that the other side must update, instead of failing the run", async () => {
    const outdated = new Error("SHARE_REMOTE_PEER_OUTDATED");
    render(
      <BulkLinkPanel
        otherName="Papa"
        loadPairs={vi.fn().mockResolvedValue({ access: "full", pairs: [pair("a"), pair("b")] })}
        preview={vi.fn((p: BulkPair) =>
          p.id === "a" ? Promise.reject(outdated) : Promise.resolve(preview(true))
        )}
        link={vi.fn()}
        undo={vi.fn()}
        failure={(err, key) =>
          err === outdated
            ? { key: "sharing:remote.errors.outdated", origin: "old.example" }
            : { key }
        }
      />
    );
    const summary = await screen.findByTestId("bulk-summary");
    expect(summary.textContent).toContain('"auto":1');
    expect(screen.getByTestId("bulk-review").textContent).toContain("sharing:bulk.review.outdated");
    expect(screen.queryByText(/sharing:bulk.state.failed/)).toBeNull();
  });
});
