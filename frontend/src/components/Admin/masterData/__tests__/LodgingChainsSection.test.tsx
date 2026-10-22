import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { get, post, patch, del, addToast } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  addToast: vi.fn(),
}));
vi.mock("../../../../lib/api/client", () => ({ api: { get, post, patch, delete: del } }));
vi.mock("../../../../store/toastStore", () => ({
  useToastStore: (select: (s: { addToast: typeof addToast }) => unknown) => select({ addToast }),
}));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

import LodgingChainsSection from "../LodgingChainsSection";

/**
 * Admin › Hotelketten (forgejo#321): the page says what each change does to
 * linked hotels and cards, refuses to offer a delete that would unlink them,
 * and shows a refusal as itself.
 */
const chain = (id: number, name: string, lodgingCount = 0, membershipCount = 0) => ({
  id,
  name,
  brandColor: null,
  loyaltyProgram: null,
  isUserAdded: false,
  createdAt: "2026-10-22T00:00:00.000Z",
  lodgingCount,
  membershipCount,
});
const LIST = {
  items: [chain(1, "Hilton", 4, 2), chain(2, "Hilton Hotels"), chain(3, "Unused")],
  total: 3,
};

describe("LodgingChainsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: LIST });
  });

  it("lists the catalogue with its count and what links to each chain", async () => {
    render(<LodgingChainsSection />);
    expect(await screen.findByText("Hilton")).toBeInTheDocument();
    expect(screen.getByTestId("lodging-chains-count")).toHaveTextContent('{"count":3}');
    expect(screen.getByTestId("lodging-chain-1")).toHaveTextContent('"lodgings":4,"memberships":2');
  });

  it("offers no delete for a chain in use and says to merge instead", async () => {
    render(<LodgingChainsSection />);
    const row = await screen.findByTestId("lodging-chain-1");
    await userEvent.click(within(row).getByRole("button", { name: "admin:lodgingChains.delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("admin:lodgingChains.deleteInUse");
    expect(within(dialog).queryByRole("button", { name: "admin:lodgingChains.delete" })).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });

  it("merges into the chosen chain after saying how many links move, then reloads", async () => {
    post.mockResolvedValue({ data: { target: chain(2, "Hilton Hotels", 4, 2), moved: {} } });
    render(<LodgingChainsSection />);
    const row = await screen.findByTestId("lodging-chain-1");
    await userEvent.click(within(row).getByRole("button", { name: "admin:lodgingChains.merge" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("combobox")).not.toBeDisabled());
    await userEvent.selectOptions(within(dialog).getByRole("combobox"), "2");
    expect(dialog).toHaveTextContent("admin:lodgingChains.mergeExplain");
    expect(dialog).toHaveTextContent('"lodgings":4');
    await userEvent.click(
      within(dialog).getByRole("button", { name: "admin:lodgingChains.mergeConfirm" })
    );
    expect(post).toHaveBeenCalledWith("/admin/lodging-chains/1/merge", { targetId: 2 });
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(3));
  });

  it("finds a merge target beyond the first page by asking the server", async () => {
    // The catalogue holds more chains than one page; the one wanted is not on it.
    get.mockImplementation((_url: string, config?: { params?: { search?: string } }) =>
      Promise.resolve({
        data:
          config?.params?.search === "Ritz"
            ? { items: [chain(450, "Ritz-Carlton")], total: 1 }
            : { ...LIST, total: 450 },
      })
    );
    post.mockResolvedValue({ data: { target: chain(450, "Ritz-Carlton", 4, 2), moved: {} } });
    render(<LodgingChainsSection />);
    const row = await screen.findByTestId("lodging-chain-1");
    await userEvent.click(within(row).getByRole("button", { name: "admin:lodgingChains.merge" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByRole("searchbox", { name: "admin:lodgingChains.mergeSearch" }),
      "Ritz"
    );
    expect(await within(dialog).findByRole("option", { name: "Ritz-Carlton" })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/admin/lodging-chains", { params: { search: "Ritz" } });
    await userEvent.selectOptions(within(dialog).getByRole("combobox"), "450");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "admin:lodgingChains.mergeConfirm" })
    );
    expect(post).toHaveBeenCalledWith("/admin/lodging-chains/1/merge", { targetId: 450 });
  });

  it("says a failed target search in the dialog and keeps the search box", async () => {
    render(<LodgingChainsSection />);
    const row = await screen.findByTestId("lodging-chain-1");
    await userEvent.click(within(row).getByRole("button", { name: "admin:lodgingChains.merge" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("combobox")).not.toBeDisabled());
    get.mockRejectedValue(new Error("500"));
    await userEvent.type(
      within(dialog).getByRole("searchbox", { name: "admin:lodgingChains.mergeSearch" }),
      "Ma"
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "admin:lodgingChains.mergeSearchError"
    );
    expect(within(dialog).getByRole("searchbox")).toBeInTheDocument();
  });

  it("shows a refused merge in the dialog, not as success", async () => {
    post.mockRejectedValue({ response: { status: 409, data: { error: "chainInUse" } } });
    render(<LodgingChainsSection />);
    const row = await screen.findByTestId("lodging-chain-1");
    await userEvent.click(within(row).getByRole("button", { name: "admin:lodgingChains.merge" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("combobox")).not.toBeDisabled());
    await userEvent.selectOptions(within(dialog).getByRole("combobox"), "3");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "admin:lodgingChains.mergeConfirm" })
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "admin:lodgingChains.errors.chainInUse"
    );
    expect(addToast).not.toHaveBeenCalledWith("success", expect.anything());
  });

  it("says why an added name was refused", async () => {
    post.mockRejectedValue({ response: { status: 409, data: { error: "chainNameTaken" } } });
    render(<LodgingChainsSection />);
    await screen.findByText("Hilton");
    await userEvent.type(screen.getByLabelText("admin:lodgingChains.name"), "hilton");
    await userEvent.click(screen.getByRole("button", { name: "admin:lodgingChains.add" }));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "admin:lodgingChains.errors.chainNameTaken")
    );
  });

  it("says when the catalogue could not be loaded instead of showing it empty", async () => {
    get.mockRejectedValue(new Error("500"));
    render(<LodgingChainsSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent("admin:lodgingChains.loadError");
    expect(screen.queryByText("admin:lodgingChains.empty")).toBeNull();
  });
});
