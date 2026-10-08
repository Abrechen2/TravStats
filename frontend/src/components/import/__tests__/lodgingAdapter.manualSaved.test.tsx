/**
 * The first import-panel domain to meet forgejo#247 end to end: the real panel,
 * the real lodging adapter, the real house form. A house that was stored but
 * whose list failed to reload must say so inside the form - it used to vanish
 * with the form, leaving a dialog that closed and a list without the entry.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DomainImportPanel from "../DomainImportPanel";
import { useLodgingImportAdapter } from "../adapters/lodgingAdapter";
import { createLodging } from "../../../lib/api/lodging";
import type { Lodging } from "../../../types/lodging";

vi.mock("../../../hooks/useLodgingEntrySuggestions", () => ({
  useLodgingEntrySuggestions: () => ({
    amenities: [],
    roomAmenities: [],
    roomNumbers: [],
    roomCategories: [],
    boards: [],
  }),
}));
vi.mock("../../../lib/api/lodging", () => ({ createLodging: vi.fn(), updateLodging: vi.fn() }));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../../../store/toastStore", () => ({ useToastStore: () => vi.fn() }));
vi.mock("../EmailImportTab", () => ({ default: () => null }));
vi.mock("../../lodging/ChainPicker", () => ({ ChainPicker: () => null }));
vi.mock("../../lodging/LodgingOsmNearby", () => ({ LodgingOsmNearby: () => null }));
vi.mock("../../location/LocationInput", () => ({ LocationInput: () => null }));

const stored = { id: "new-lodging", name: "Hotel Adlon", stays: [] } as unknown as Lodging;

function Host({ reload }: { reload: () => Promise<void> }): React.JSX.Element {
  const adapter = useLodgingImportAdapter();
  return <DomainImportPanel open onClose={vi.fn()} onItemsCreated={reload} adapter={adapter} />;
}

describe("lodging add flow - a failed reload after the create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the form open with the saved-but-not-refreshed notice and creates once", async () => {
    vi.mocked(createLodging).mockResolvedValue(stored);
    const reload = vi.fn().mockRejectedValue(new Error("list unavailable"));
    render(<Host reload={reload} />);

    await userEvent.click(screen.getByRole("button", { name: "import:route.manual" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: /lodging:field\.name/ }),
      "Hotel Adlon"
    );
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.save" }));

    expect(await screen.findByText("common:form.savedButRefreshFailed")).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(createLodging).toHaveBeenCalledTimes(1);
    // The form is still there; the only action left is to close it.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "common:buttons.save" })).toBeNull()
    );
  });
});
