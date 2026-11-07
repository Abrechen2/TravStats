import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FriendDetailSheet from "../FriendDetailSheet";
import { comparisonApi } from "../../../lib/api/comparison";
import { SCOPE, person, friendView } from "./fixtures";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock(
  "../../comparison/ConsentDialog",
  async () => (await import("./fixtures")).consentDialogStub
);
vi.mock("../../../lib/api/comparison", async (original) => ({
  ...(await original<typeof import("../../../lib/api/comparison")>()),
  comparisonApi: {
    updateScope: vi.fn().mockResolvedValue({}),
    end: vi.fn().mockResolvedValue({ ended: true }),
  },
}));

const ben = person("11111111-1111-4111-8111-111111111111", "Ben");

describe("FriendDetailSheet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows what a withdrawn friend shares as withdrawn, not as nothing", () => {
    render(
      <FriendDetailSheet
        friend={friendView(ben, { status: "withdrawn", answeredAt: null })}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    );
    expect(screen.getByTestId("detail-they-share").textContent).toBe("status.withdrawn");
  });

  it("changes the scope through the dialog", async () => {
    const onChanged = vi.fn();
    render(<FriendDetailSheet friend={friendView(ben)} onClose={vi.fn()} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "detail.edit" }));
    expect(screen.getByRole("button", { name: "confirm-dialog" })).toHaveAttribute(
      "data-mode",
      "change"
    );
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await waitFor(() =>
      expect(comparisonApi.updateScope).toHaveBeenCalledWith(`c-${ben.key}`, SCOPE)
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("asks before removing, then ends with the person's key", async () => {
    const onClose = vi.fn();
    render(<FriendDetailSheet friend={friendView(ben)} onClose={onClose} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "detail.remove" }));
    expect(comparisonApi.end).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "people.endConfirm" }));
    await waitFor(() => expect(comparisonApi.end).toHaveBeenCalledWith(ben.key));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("says why removing failed and stays open", async () => {
    vi.mocked(comparisonApi.end).mockRejectedValueOnce(new Error("boom"));
    const onClose = vi.fn();
    render(<FriendDetailSheet friend={friendView(ben)} onClose={onClose} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "detail.remove" }));
    fireEvent.click(screen.getByRole("button", { name: "people.endConfirm" }));
    expect((await screen.findByRole("alert")).textContent).toBe("error.unknown");
    expect(onClose).not.toHaveBeenCalled();
  });
});
