import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PurposeChip from "../PurposeChip";
import PurposeEditor from "../PurposeEditor";
import PurposeCatalogueSection from "../../Settings/PurposeCatalogueSection";
import YearPurposeBreakdown from "../../Stats/Overview/YearPurposeBreakdown";
import { purposeApi, type CustomPurposeEntry } from "../../../lib/api/purpose";
import { usePurposeCatalogueStore } from "../../../store/purposeCatalogueStore";
import { visitDraft, visitPayload } from "../../places/visitDialogModel";
import type { PlaceVisit } from "../../../types/place";

vi.mock("../../../lib/api/purpose", () => ({
  purposeApi: {
    set: vi.fn(),
    catalogue: vi.fn(),
    createCustom: vi.fn(),
    updateCustom: vi.fn(),
    deleteCustom: vi.fn(),
  },
}));

const CUSTOM_ID = "0b9f6c1e-1d2a-4f3b-9c8d-7e6f5a4b3c2d";
const custom = (extra: Partial<CustomPurposeEntry> = {}): CustomPurposeEntry => ({
  key: `custom:${CUSTOM_ID}`,
  id: CUSTOM_ID,
  name: "Ehrenamt",
  nameEn: null,
  kind: "private",
  color: "#123456",
  icon: "heart",
  archived: false,
  usage: 0,
  ...extra,
});

/** Puts the account's own purposes into the store, as a loaded catalogue. */
const withCustom = (entries: CustomPurposeEntry[]): void => {
  const state = usePurposeCatalogueStore.getState();
  usePurposeCatalogueStore.setState({
    catalogue: { ...state.catalogue, custom: entries },
    loaded: true,
    failed: false,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  withCustom([]);
});

describe("the purpose picker", () => {
  it("offers the built-ins and the user's own purposes, grouped by kind", () => {
    withCustom([custom(), custom({ id: "x", key: "custom:x", name: "Alt", archived: true })]);
    render(<PurposeEditor entryType="flight" entryId="f1" purpose={null} />);
    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("label"))).toEqual([
      "purpose:kind.private",
      "purpose:kind.business",
    ]);
    const business = within(groups[1])
      .getAllByRole("option")
      .map((o) => o.getAttribute("value"));
    expect(business).toEqual(["builtin:business", "builtin:trade_fair"]);
    const privateKeys = within(groups[0])
      .getAllByRole("option")
      .map((o) => o.getAttribute("value"));
    expect(privateKeys).toContain(`custom:${CUSTOM_ID}`);
    // An archived purpose is not offered for a new choice.
    expect(privateKeys).not.toContain("custom:x");
  });

  it("a legacy business entry shows as Geschäftlich, and a chosen key is sent as is", async () => {
    vi.mocked(purposeApi.set).mockResolvedValue({
      purpose: "business",
      purposeKey: "builtin:trade_fair",
    });
    render(<PurposeEditor entryType="flight" entryId="f1" purpose="business" />);
    expect(screen.getByRole("combobox")).toHaveValue("builtin:business");
    await userEvent.selectOptions(screen.getByRole("combobox"), "builtin:trade_fair");
    await waitFor(() =>
      expect(purposeApi.set).toHaveBeenCalledWith("flight", "f1", "builtin:trade_fair")
    );
  });
});

describe("the purpose chip", () => {
  it("names a detail, stays quiet for Privat (sonstiges), and treats a stale detail as its kind", () => {
    const { rerender } = render(
      <PurposeChip entry={{ purpose: "business", purposeKey: "builtin:trade_fair" }} />
    );
    expect(screen.getByTestId("purpose-chip")).toHaveTextContent("purpose:builtin.trade_fair");
    rerender(<PurposeChip entry={{ purpose: "private", purposeKey: "builtin:vacation" }} />);
    expect(screen.getByTestId("purpose-chip")).toHaveTextContent("purpose:builtin.vacation");
    rerender(<PurposeChip entry={{ purpose: "private", purposeKey: null }} />);
    expect(screen.queryByTestId("purpose-chip")).toBeNull();
    // An old app flipped the kind without knowing the detail: the kind wins.
    rerender(<PurposeChip entry={{ purpose: "private", purposeKey: "builtin:trade_fair" }} />);
    expect(screen.queryByTestId("purpose-chip")).toBeNull();
  });
});

describe("Reisezwecke settings", () => {
  it("offers delete only for an unused purpose; a used one can only be archived", () => {
    withCustom([
      custom({ usage: 0 }),
      custom({ id: "used", key: "custom:used", name: "Kunde", usage: 3 }),
    ]);
    render(<PurposeCatalogueSection />);
    const unused = screen.getByTestId(`custom-purpose-${CUSTOM_ID}`);
    expect(
      within(unused).getByRole("button", { name: "purpose:custom.delete" })
    ).toBeInTheDocument();
    const used = screen.getByTestId("custom-purpose-used");
    expect(within(used).queryByRole("button", { name: "purpose:custom.delete" })).toBeNull();
    expect(
      within(used).getByRole("button", { name: "purpose:custom.archive" })
    ).toBeInTheDocument();
  });

  it("says out loud when the server refuses a delete because the purpose is in use", async () => {
    withCustom([custom()]);
    vi.mocked(purposeApi.deleteCustom).mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { code: "PURPOSE_IN_USE" } },
    });
    render(<PurposeCatalogueSection />);
    await userEvent.click(screen.getByRole("button", { name: "purpose:custom.delete" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("creates a purpose with its kind, colour and icon", async () => {
    vi.mocked(purposeApi.createCustom).mockResolvedValue(custom());
    vi.mocked(purposeApi.catalogue).mockResolvedValue({
      builtins: usePurposeCatalogueStore.getState().catalogue.builtins,
      custom: [custom()],
    });
    render(<PurposeCatalogueSection />);
    await userEvent.type(screen.getAllByLabelText("purpose:custom.name")[0], "Ehrenamt");
    await userEvent.click(screen.getByRole("button", { name: "purpose:custom.add" }));
    await waitFor(() =>
      expect(purposeApi.createCustom).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Ehrenamt", kind: "private" })
      )
    );
  });
});

describe("Reisezwecke when the catalogue could not be loaded", () => {
  it("says so with a retry instead of showing an empty list", () => {
    usePurposeCatalogueStore.setState({ failed: true });
    render(<PurposeCatalogueSection />);
    expect(screen.getByRole("alert")).toHaveTextContent("purpose:custom.loadError");
  });
});

describe("visit form with a detailed purpose", () => {
  it("opens on the stored detail and sends it back as a key", () => {
    const visit = {
      id: "v1",
      purpose: "business",
      purposeKey: "builtin:trade_fair",
      visitedAt: null,
      notes: null,
      rating: null,
      tripId: null,
    } as unknown as PlaceVisit;
    const draft = visitDraft(visit, undefined, () => undefined);
    expect(draft.purpose).toBe("builtin:trade_fair");
    expect(visitPayload(draft, "2025-01-01", "p1", true).purpose).toBe("builtin:trade_fair");
  });
});

describe("Nach Zweck on the year card", () => {
  it("lists purposes with counts, and stays away when no entry has a purpose", () => {
    const { rerender } = render(
      <YearPurposeBreakdown
        year={2024}
        rows={[
          { key: "builtin:trade_fair", count: 2, km: 1200 },
          { key: null, count: 1, km: null },
        ]}
      />
    );
    const box = screen.getByTestId("year-purpose-2024");
    expect(box).toHaveTextContent("purpose:builtin.trade_fair");
    expect(box).toHaveTextContent("purpose:stats.unknown");
    rerender(<YearPurposeBreakdown year={2024} rows={[{ key: null, count: 3, km: null }]} />);
    expect(screen.queryByTestId("year-purpose-2024")).toBeNull();
  });
});
