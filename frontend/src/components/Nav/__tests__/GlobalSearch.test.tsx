import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import axios from "axios";

import GlobalSearch from "../GlobalSearch";
import { searchApi, type SearchResult } from "../../../lib/api/search";
import { useAuthStore } from "../../../store/authStore";

vi.mock("../../../lib/api/search", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api/search")>()),
  searchApi: { search: vi.fn() },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0 ? `${key}|${JSON.stringify(opts)}` : key,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "lodging"], isEnabled: () => true }),
}));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: () => false }));
vi.mock("../../../hooks/useDebouncedValue", () => ({ useDebouncedValue: <T,>(v: T) => v }));
vi.mock("../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colors: {}, colorOf: () => "#abcdef" }),
}));

const result = (over: Partial<SearchResult> = {}): SearchResult => ({
  query: "lh",
  hits: [
    {
      domain: "flight",
      kind: "flight",
      id: "f1",
      title: "LH123",
      subtitle: "MUC → VIE",
      date: { date: "2026-01-01", zone: "Europe/Berlin", precision: "day" },
      path: "/flights/f1",
    },
    {
      domain: "lodging",
      kind: "lodging",
      id: "l1",
      title: "Hotel Lisboa",
      subtitle: null,
      date: null,
      path: "/lodging/l1",
    },
  ],
  more: [],
  failed: [],
  capped: false,
  ...over,
});

function Where(): JSX.Element {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderBox(): HTMLInputElement {
  render(
    <MemoryRouter>
      <GlobalSearch />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
  return screen.getByRole("combobox") as HTMLInputElement;
}

const httpError = (status?: number): Error =>
  Object.assign(new axios.AxiosError("x"), { response: status ? { status } : undefined });

describe("the header search (forgejo#403)", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

  it("is narrow by default so the header row fits a 320 px viewport (layout-320 overflow)", () => {
    // jsdom has no layout; the e2e layout.noHorizontalOverflow spec measures it.
    // The 96 px default made the header's right cluster 316 px wide, 13 px more
    // than a 320 px window leaves it.
    const box = renderBox();
    expect(box.className).toMatch(/(^|\s)w-14(\s|$)/);
    expect(box.className).not.toMatch(/(^|\s)w-24(\s|$)/);
  });

  it("focuses on '/' unless the user is typing elsewhere", () => {
    const box = renderBox();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(box).toHaveFocus();
    box.blur();
    const other = document.createElement("input");
    document.body.appendChild(other);
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(box).not.toHaveFocus();
    other.remove();
  });

  it("sends only the account's domains and shows hits grouped, then opens one with the keyboard", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(result());
    const box = renderBox();
    fireEvent.change(box, { target: { value: "lh" } });

    expect(await screen.findByText("LH123")).toBeInTheDocument();
    expect(searchApi.search).toHaveBeenCalledWith(
      expect.objectContaining({ q: "lh", domains: ["flight", "lodging", "trip"] }),
      expect.anything()
    );
    expect(
      screen.getByRole("group", { name: "dashboard:search.group.flight" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "dashboard:search.group.lodging" })
    ).toBeInTheDocument();

    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByTestId("where")).toHaveTextContent("/lodging/l1");
  });

  it("narrows the search to the chosen domain chips and keeps the typing field focused", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(result());
    const box = renderBox();
    act(() => box.focus());
    fireEvent.change(box, { target: { value: "lh" } });
    await screen.findByText("LH123");
    fireEvent.click(screen.getByTestId("search-chip-lodging"));
    await waitFor(() =>
      expect(searchApi.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "lh", domains: ["lodging"] }),
        expect.anything()
      )
    );
    await waitFor(() => expect(screen.queryByText("dashboard:search.loading")).toBeNull());
    expect(screen.getByTestId("search-chip-lodging")).toHaveAttribute("aria-pressed", "true");
    // The chip is not a tab stop and does not steal the field's arrow keys.
    expect(screen.getByTestId("search-chip-lodging")).toHaveAttribute("tabindex", "-1");
    expect(box).toHaveFocus();
  });

  describe("recent queries", () => {
    beforeEach(() => {
      localStorage.clear();
      useAuthStore.setState({ user: { id: "u1" } as never });
    });
    afterEach(() => {
      cleanup();
      useAuthStore.setState({ user: null });
    });

    it("remembers a query once a result was opened, offers it on an empty field and can forget it", async () => {
      vi.mocked(searchApi.search).mockResolvedValue(result());
      const box = renderBox();
      fireEvent.change(box, { target: { value: "lh" } });
      await screen.findByText("LH123");
      fireEvent.keyDown(box, { key: "Enter" });
      expect(JSON.parse(localStorage.getItem("travstats:global-search-recent:u1") ?? "[]")).toEqual(
        ["lh"]
      );

      // Back on an empty, focused field: the remembered query, walkable with arrows.
      fireEvent.change(box, { target: { value: "" } });
      fireEvent.focus(box);
      expect(screen.getByTestId("search-recent-0")).toHaveTextContent("lh");
      fireEvent.keyDown(box, { key: "Enter" });
      expect(box.value).toBe("lh");
      await waitFor(() => expect(screen.queryByText("dashboard:search.loading")).toBeNull());

      fireEvent.change(box, { target: { value: "" } });
      fireEvent.click(screen.getByTestId("search-recent-clear"));
      expect(localStorage.getItem("travstats:global-search-recent:u1")).toBeNull();
      expect(screen.queryByTestId("search-recent-0")).toBeNull();
    });

    it("never offers another account's queries", () => {
      localStorage.setItem("travstats:global-search-recent:u2", JSON.stringify(["secret"]));
      const box = renderBox();
      fireEvent.focus(box);
      expect(screen.queryByText("secret")).toBeNull();
    });
  });

  it("asks for more characters instead of searching on one", () => {
    const box = renderBox();
    fireEvent.change(box, { target: { value: "l" } });
    expect(screen.getByText(/dashboard:search.tooMuchTooLittle/)).toBeInTheDocument();
    expect(searchApi.search).not.toHaveBeenCalled();
  });

  it("says 'no matches' only for a real empty answer", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(result({ hits: [] }));
    fireEvent.change(renderBox(), { target: { value: "zz" } });
    expect(await screen.findByText(/dashboard:search.empty\|/)).toBeInTheDocument();
  });

  it.each([
    [undefined, "network"],
    [429, "rateLimit"],
    [401, "auth"],
    [500, "server"],
  ])("explains a failed search (HTTP %s) as %s, never as 'no matches'", async (status, reason) => {
    vi.mocked(searchApi.search).mockRejectedValue(httpError(status));
    fireEvent.change(renderBox(), { target: { value: "lh" } });
    expect(await screen.findByText(`dashboard:search.error.${reason}`)).toBeInTheDocument();
    expect(screen.queryByText(/dashboard:search.empty\|/)).not.toBeInTheDocument();
  });

  it("offers a retry that searches again", async () => {
    vi.mocked(searchApi.search)
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValueOnce(result());
    fireEvent.change(renderBox(), { target: { value: "lh" } });
    fireEvent.click(await screen.findByText("dashboard:search.error.retry"));
    await waitFor(() => expect(screen.getByText("LH123")).toBeInTheDocument());
    expect(searchApi.search).toHaveBeenCalledTimes(2);
  });

  it("names the domains the server could not search rather than hiding the gap", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(result({ hits: [], failed: ["flight"] }));
    fireEvent.change(renderBox(), { target: { value: "lh" } });
    expect(await screen.findByText(/dashboard:search.partial/)).toBeInTheDocument();
    expect(screen.queryByText(/dashboard:search.empty\|/)).not.toBeInTheDocument();
  });
});
