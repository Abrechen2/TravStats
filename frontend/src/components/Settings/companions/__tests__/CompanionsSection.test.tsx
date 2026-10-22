import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import CompanionsSection from "../CompanionsSection";
import { companionsApi, type ManagedCompanion } from "../../../../lib/api/companions";

/**
 * Settings → Mitreisende: rename (a taken name offers the merge), merge (a
 * preview first; a link conflict keeps the button off), delete only what is
 * unused, and a failed load that says so.
 */
vi.mock("../../../../lib/api/companions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/companions")>()),
  companionsApi: {
    manage: vi.fn(),
    rename: vi.fn(),
    mergePreview: vi.fn(),
    merge: vi.fn(),
    remove: vi.fn(),
    deleteUnused: vi.fn(),
  },
}));

const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const api = vi.mocked(companionsApi);

const row = (over: Partial<ManagedCompanion>): ManagedCompanion => ({
  id: "c1",
  name: "Norber",
  linkedUser: null,
  uses: { flight: 2, trip: 0 },
  hiddenUses: 0,
  expensesPaid: 0,
  lastTogether: "2025-05-08",
  inUse: true,
  ...over,
});
const norber = row({});
const norbert = row({ id: "c2", name: "Norbert", uses: { flight: 1, trip: 1 } });
const unused = row({ id: "c3", name: "Nobody", uses: { flight: 0, trip: 0 }, inUse: false });

const renderSection = () =>
  render(
    <MemoryRouter>
      <CompanionsSection />
    </MemoryRouter>
  );

const rowOf = async (id: string) => within(await screen.findByTestId(`companion-row-${id}`));

describe("CompanionsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.manage.mockResolvedValue({
      companions: [norber, norbert, unused],
      kinds: ["flight", "trip"],
    });
  });

  it("offers delete only for an unused companion, and links to the sharing settings", async () => {
    renderSection();
    const used = await rowOf("c1");
    expect(used.queryByRole("button", { name: "companions:manage.actions.delete" })).toBeNull();
    expect(used.getByText("companions:manage.inUseHint")).toBeTruthy();
    expect(used.getByRole("link").getAttribute("href")).toBe("/settings/trips?section=sharing");
    const free = await rowOf("c3");
    api.remove.mockResolvedValue();
    await userEvent.click(free.getByRole("button", { name: "companions:manage.actions.delete" }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "companions:manage.delete.submit",
      })
    );
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("c3"));
  });

  it("turns a rename onto a taken name into an offer to merge, with a preview", async () => {
    api.rename.mockRejectedValue({
      response: {
        status: 409,
        data: { code: "COMPANION_NAME_TAKEN", companionId: "c2", companionName: "Norbert" },
      },
    });
    api.mergePreview.mockResolvedValue({
      source: { id: "c1", name: "Norber", linkedUser: null },
      target: { id: "c2", name: "Norbert", linkedUser: null },
      entries: { flight: { entries: 2, shared: 1 } },
      hiddenEntries: 0,
      expensesPaid: 1,
      renamedLists: 2,
      link: "none",
      allowed: true,
    });
    api.merge.mockResolvedValue({} as never);
    renderSection();
    const used = await rowOf("c1");
    await userEvent.click(used.getByRole("button", { name: "companions:manage.actions.rename" }));
    const input = screen.getByLabelText("companions:manage.rename.label");
    await userEvent.clear(input);
    await userEvent.type(input, "Norbert");
    await userEvent.click(screen.getByRole("button", { name: "companions:manage.rename.submit" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "companions:manage.rename.mergeInstead" })
    );
    await waitFor(() => expect(api.mergePreview).toHaveBeenCalledWith("c1", "c2"));
    expect(await screen.findByTestId("companion-merge-preview")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "companions:manage.merge.submit" }));
    await waitFor(() => expect(api.merge).toHaveBeenCalledWith("c1", "c2"));
  });

  it("explains a link conflict and keeps the merge button off", async () => {
    api.mergePreview.mockResolvedValue({
      source: { id: "c1", name: "Norber", linkedUser: null },
      target: { id: "c2", name: "Norbert", linkedUser: null },
      entries: {},
      hiddenEntries: 0,
      expensesPaid: 0,
      renamedLists: 0,
      link: "conflict",
      allowed: false,
    });
    renderSection();
    const used = await rowOf("c1");
    await userEvent.click(used.getByRole("button", { name: "companions:manage.actions.merge" }));
    await userEvent.selectOptions(
      screen.getByLabelText("companions:manage.merge.targetLabel"),
      "c2"
    );
    expect(await screen.findByText("companions:manage.merge.link.conflict")).toBeTruthy();
    const submit = screen.getByRole("button", { name: "companions:manage.merge.submit" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("says when the list could not be loaded, and retries", async () => {
    api.manage.mockRejectedValueOnce(new Error("down"));
    renderSection();
    expect(await screen.findByText("companions:manage.loadFailed")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "companions:manage.retry" }));
    expect(await screen.findByTestId("companion-row-c1")).toBeTruthy();
  });
});
