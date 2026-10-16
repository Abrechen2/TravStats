import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LinkAccountDialog from "../LinkAccountDialog";
import { sharingApi } from "../../../lib/api/sharing";

/** Linking a companion from the trip page (spec 2026-10-16, D9) — until now only in Einstellungen. */
vi.mock("../../../lib/api/sharing", () => ({
  sharingApi: { linkCompanion: vi.fn(), requestConsent: vi.fn() },
}));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));
const api = vi.mocked(sharingApi);
const ben = { id: "u-ben", username: "ben", displayName: "Ben" };

describe("LinkAccountDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("links to an account that agreed", async () => {
    api.linkCompanion.mockResolvedValue({ id: "c1", name: "Ben", linkedUser: ben });
    const onLinked = vi.fn();
    render(
      <LinkAccountDialog
        open
        onClose={vi.fn()}
        companion={{ id: "c1", name: "Ben" }}
        linkableUsers={[ben]}
        onLinked={onLinked}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText("sharing:linkDialog.account"), "u-ben");
    await userEvent.click(screen.getByRole("button", { name: "sharing:linkDialog.link" }));
    expect(api.linkCompanion).toHaveBeenCalledWith("c1", "u-ben");
    await waitFor(() => expect(onLinked).toHaveBeenCalled());
  });

  it("asks for consent by username when nobody has agreed yet", async () => {
    api.requestConsent.mockResolvedValue({} as never);
    const onClose = vi.fn();
    render(
      <LinkAccountDialog
        open
        onClose={onClose}
        companion={{ id: "c1", name: "Ilse" }}
        linkableUsers={[]}
        onLinked={vi.fn()}
      />
    );
    await userEvent.type(screen.getByLabelText("sharing:linkDialog.username"), "ilse");
    await userEvent.click(screen.getByRole("button", { name: "sharing:linkDialog.request" }));
    expect(api.requestConsent).toHaveBeenCalledWith("ilse");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows a refusal as a sentence, not as the server code", async () => {
    api.linkCompanion.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { code: "SHARE_COMPANION_ALREADY_LINKED" } },
    });
    render(
      <LinkAccountDialog
        open
        onClose={vi.fn()}
        companion={{ id: "c1", name: "Ben" }}
        linkableUsers={[ben]}
        onLinked={vi.fn()}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText("sharing:linkDialog.account"), "u-ben");
    await userEvent.click(screen.getByRole("button", { name: "sharing:linkDialog.link" }));
    expect((await screen.findByRole("alert")).textContent).toBe("sharing:errors.alreadyLinked");
  });
});
