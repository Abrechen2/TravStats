import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SharingSection from "../SharingSection";
import { sharingApi } from "../../../lib/api/sharing";

/**
 * "Mit Konten auf diesem Server" on the rebuilt rows: ending a sharing that
 * has already copied trips asks first and names whom it affects; a request
 * that was never answered withdraws without a question; a refusal is said.
 */
vi.mock("../../../lib/api/sharing", () => ({
  sharingApi: {
    listConsents: vi.fn(),
    listCompanions: vi.fn(),
    requestConsent: vi.fn(),
    answerConsent: vi.fn(),
    linkCompanion: vi.fn(),
    unlinkCompanion: vi.fn(),
  },
}));
let demo = false;
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo }));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (select: (s: { addToast: typeof addToast }) => unknown) => select({ addToast }),
}));

const api = vi.mocked(sharingApi);
const person = { id: "u2", username: "jonas", displayName: "Jonas" };
const consent = (id: string, status: "pending" | "accepted") => ({
  id,
  status,
  createdAt: "2030-01-01T00:00:00Z",
  decidedAt: null,
  person,
});

describe("SharingSection (Mit Konten auf diesem Server)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    demo = false;
    api.listConsents.mockResolvedValue({ incoming: [], outgoing: [consent("c1", "accepted")] });
    api.listCompanions.mockResolvedValue({ companions: [], linkableUsers: [person] });
    api.answerConsent.mockResolvedValue(undefined as never);
  });

  it("asks before ending an accepted sharing and withdraws only on the answer", async () => {
    render(<SharingSection />);
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:settings.consents.withdraw" })
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("settingsRows:dialogs.shareend.title");
    expect(api.answerConsent).not.toHaveBeenCalled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "settingsRows:dialogs.shareend.confirm" })
    );
    await waitFor(() => expect(api.answerConsent).toHaveBeenCalledWith("c1", "withdraw"));
  });

  it("cancelling keeps the sharing", async () => {
    render(<SharingSection />);
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:settings.consents.withdraw" })
    );
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "settings:blocks.confirm.cancel",
      })
    );
    expect(api.answerConsent).not.toHaveBeenCalled();
  });

  it("withdraws a request that was never answered at once: nothing was shared", async () => {
    api.listConsents.mockResolvedValue({ incoming: [], outgoing: [consent("c2", "pending")] });
    render(<SharingSection />);
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:settings.consents.withdraw" })
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(api.answerConsent).toHaveBeenCalledWith("c2", "withdraw"));
  });

  it("says a refused withdrawal failed, with its own reason, and the list stays", async () => {
    api.answerConsent.mockRejectedValue(new Error("Network Error"));
    render(<SharingSection />);
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:settings.consents.withdraw" })
    );
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "settingsRows:dialogs.shareend.confirm",
      })
    );
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", expect.stringContaining("sharing:"))
    );
    expect(api.listConsents).toHaveBeenCalledTimes(1);
  });

  it("says when the sharing settings cannot be loaded instead of drawing empty lists", async () => {
    api.listConsents.mockRejectedValue(new Error("down"));
    render(<SharingSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "sharing:settings.errors.loadFailed"
    );
  });

  it("locks the whole row in the demo account, with the reason", async () => {
    demo = true;
    render(<SharingSection />);
    expect(await screen.findByLabelText("sharing:settings.request.label")).toBeDisabled();
    expect(screen.getAllByText("settings:blocks.lock.demo").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "sharing:settings.consents.withdraw" })
    ).toBeDisabled();
  });
});
