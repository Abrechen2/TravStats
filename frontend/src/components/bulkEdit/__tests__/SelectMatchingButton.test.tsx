import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import SelectMatchingButton from "../SelectMatchingButton";
import DomainBulkBar from "../DomainBulkBar";
import { useRowSelection } from "../useRowSelection";
import { collectAllPages } from "../../../lib/collectPages";

vi.mock("../DomainBulkEditModal", () => ({ default: () => null }));

describe("SelectMatchingButton", () => {
  it("names the server's count and selects every match, beyond the page in view", async () => {
    const onSelect = vi.fn();
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    render(
      <SelectMatchingButton
        matching={{ total: 3, resolve: () => Promise.resolve(rows) }}
        pageCount={1}
        onSelect={onSelect}
      />
    );
    const button = screen.getByTestId("bulk-select-matching");
    expect(button).toHaveTextContent('"count":3');
    await userEvent.click(button);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(rows));
  });

  it("is not offered when the page already holds every match", () => {
    render(
      <SelectMatchingButton
        matching={{ total: 2, resolve: () => Promise.resolve([]) }}
        pageCount={2}
        onSelect={vi.fn()}
      />
    );
    expect(screen.queryByTestId("bulk-select-matching")).toBeNull();
  });

  it("says a failed read and leaves the selection alone", async () => {
    const onSelect = vi.fn();
    render(
      <SelectMatchingButton
        matching={{ total: 9, resolve: () => Promise.reject(new Error("down")) }}
        pageCount={1}
        onSelect={onSelect}
      />
    );
    await userEvent.click(screen.getByTestId("bulk-select-matching"));
    expect(await screen.findByRole("alert")).toHaveTextContent("selectMatchingFailed");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("refuses to select a prefix when there are too many matches", () => {
    render(
      <SelectMatchingButton
        matching={{ total: 9000, resolve: () => Promise.resolve([]) }}
        pageCount={50}
        onSelect={vi.fn()}
      />
    );
    expect(screen.queryByTestId("bulk-select-matching")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("selectMatchingTooMany");
  });
});

describe("DomainBulkBar select all matching", () => {
  function Harness(): JSX.Element {
    const selection = useRowSelection();
    return (
      <>
        <button type="button" onClick={selection.start}>
          start
        </button>
        <DomainBulkBar
          domain="rail"
          selection={selection}
          pageRows={[{ id: "a", label: "A" }]}
          matching={{
            total: 3,
            resolve: () =>
              Promise.resolve([
                { id: "a", label: "A" },
                { id: "b", label: "B" },
                { id: "c", label: "C" },
              ]),
          }}
          onApplied={vi.fn()}
        />
      </>
    );
  }
  it("selects all matches, not only the page", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("start"));
    await userEvent.click(screen.getByTestId("bulk-select-matching"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent('"count":3'));
  });
});

describe("collectAllPages", () => {
  it("walks pages of 500 until the total is read", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: new Array(500).fill(1), total: 620 })
      .mockResolvedValueOnce({ items: new Array(120).fill(2), total: 620 });
    const all = await collectAllPages(fetchPage);
    expect(all).toHaveLength(620);
    expect(fetchPage).toHaveBeenNthCalledWith(2, { limit: 500, offset: 500 });
  });

  it("rejects a short page while the server still counts more, instead of returning a prefix", async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ items: new Array(40).fill(1), total: 60 });
    await expect(collectAllPages(fetchPage)).rejects.toThrow("incomplete");
  });

  it("rejects when a page fails instead of returning a prefix", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: new Array(500).fill(1), total: 900 })
      .mockRejectedValueOnce(new Error("boom"));
    await expect(collectAllPages(fetchPage)).rejects.toThrow("boom");
  });
});
