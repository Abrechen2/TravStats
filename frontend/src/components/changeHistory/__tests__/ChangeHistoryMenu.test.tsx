import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import DetailMoreMenu from "../../detail/DetailMoreMenu";
import ChangeHistoryMenuButton from "../ChangeHistoryMenuButton";
import ChangeHistoryRetentionRow from "../../Settings/ChangeHistoryRetentionRow";
import { changeHistoryApi } from "../../../lib/api/changeHistory";

vi.mock("../../../lib/api/changeHistory", () => ({
  changeHistoryApi: {
    forEntry: vi.fn(),
    restore: vi.fn(),
    retention: vi.fn(),
    setRetention: vi.fn(),
  },
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../../lodging/LodgingEnrichButton", () => ({
  useLodgingEnrich: () => ({ available: false, busy: false, label: "", ask: vi.fn(), node: null }),
}));
const api = vi.mocked(changeHistoryApi);

const oneRow = {
  id: "00000000-0000-4000-8000-000000000001",
  changeSetId: "cs1",
  entityType: "flight" as const,
  entityId: "f1",
  operation: "update" as const,
  field: "seatNumber",
  oldValue: "12A",
  newValue: "30F",
  valueType: "String",
  omitted: false,
  label: "LH400",
  source: "web" as const,
  actor: "self" as const,
  reason: null,
  restoredFromId: null,
  restorable: false,
  createdAt: "2026-11-22T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  api.forEntry.mockResolvedValue({ entries: [oneRow], nextCursor: null });
  api.retention.mockResolvedValue({ months: 12, options: [3, 6, 12, 24] });
});

describe("the change history lives in the entry's ⋯ menu", () => {
  it("shows no history section and asks for nothing until the menu item is chosen", async () => {
    render(
      <MemoryRouter>
        <DetailMoreMenu
          history={{ entityType: "flight", entityId: "f1" }}
          onDelete={() => undefined}
        />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("change-history")).toBeNull();
    expect(screen.queryByRole("button", { name: "changeHistory:show" })).toBeNull();
    expect(api.forEntry).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("detail-more-menu"));
    await userEvent.click(screen.getByRole("menuitem", { name: "changeHistory:menu" }));

    expect(await screen.findByTestId("change-history-row")).toHaveTextContent("12A → 30F");
    expect(api.forEntry).toHaveBeenCalledWith("flight", "f1");
    // The dialog names the rolling window the rows are kept for.
    expect(await screen.findByTestId("change-history-window")).toHaveTextContent(
      "changeHistory:window"
    );
    expect(api.retention).toHaveBeenCalled();
  });

  it("leaves the item out when the page passes no history", async () => {
    render(
      <MemoryRouter>
        <DetailMoreMenu onDelete={() => undefined} />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByTestId("detail-more-menu"));
    expect(screen.queryByRole("menuitem", { name: "changeHistory:menu" })).toBeNull();
  });

  it("opens a card's history from its own bare ⋯ (visit, cruise day, expense)", async () => {
    render(<ChangeHistoryMenuButton entityType="placeVisit" entityId="v1" />);
    await userEvent.click(screen.getByTestId("change-history-menu"));
    await userEvent.click(screen.getByRole("menuitem", { name: "changeHistory:menu" }));
    expect(await screen.findByTestId("change-history-row")).toBeInTheDocument();
    expect(api.forEntry).toHaveBeenCalledWith("placeVisit", "v1");
  });

  it("still lists the history when the window sentence cannot be loaded", async () => {
    api.retention.mockRejectedValue(new Error("down"));
    render(<ChangeHistoryMenuButton entityType="placeVisit" entityId="v1" />);
    await userEvent.click(screen.getByTestId("change-history-menu"));
    await userEvent.click(screen.getByRole("menuitem", { name: "changeHistory:menu" }));
    expect(await screen.findByTestId("change-history-row")).toBeInTheDocument();
    expect(screen.queryByTestId("change-history-window")).toBeNull();
  });
});

describe("the retention setting", () => {
  it("shows the saved window and writes a new choice to the server", async () => {
    api.retention.mockResolvedValue({ months: 12, options: [3, 6, 12, 24] });
    api.setRetention.mockResolvedValue({ months: 24, options: [3, 6, 12, 24] });
    render(<ChangeHistoryRetentionRow />);
    const choice = await screen.findByRole("combobox");
    expect(choice).toHaveValue("12");
    await userEvent.selectOptions(choice, "24");
    await waitFor(() => expect(api.setRetention).toHaveBeenCalledWith(24));
  });
});
