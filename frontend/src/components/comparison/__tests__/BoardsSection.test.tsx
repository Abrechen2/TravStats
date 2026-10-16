import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BoardsSection from "../BoardsSection";
import { comparisonApi } from "../../../lib/api/comparison";

const SCOPE = vi.hoisted(() => ({ groups: ["trips"], domains: ["flight"], year: null }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../ConsentDialog", () => ({
  default: ({ open, onConfirm }: { open: boolean; onConfirm: (s: unknown) => Promise<void> }) =>
    open ? <button onClick={() => void onConfirm(SCOPE)}>confirm-dialog</button> : null,
}));
vi.mock("../../../lib/api/comparison", async (original) => ({
  ...(await original<typeof import("../../../lib/api/comparison")>()),
  comparisonApi: {
    accept: vi.fn().mockResolvedValue({}),
    decline: vi.fn().mockResolvedValue({}),
    updateScope: vi.fn().mockResolvedValue({}),
    end: vi.fn().mockResolvedValue({ ended: true }),
    request: vi.fn().mockResolvedValue({}),
    createInvite: vi.fn().mockResolvedValue({
      code: "https://me.example#" + "a".repeat(64),
      expiresAt: "2026-10-19T00:00:00.000Z",
    }),
    claimInvite: vi.fn().mockResolvedValue({}),
    saveBoard: vi.fn().mockResolvedValue({}),
    deleteBoard: vi.fn().mockResolvedValue({ deleted: true }),
  },
}));

const ben = {
  key: "local:11111111-1111-4111-8111-111111111111",
  kind: "local" as const,
  username: "ben",
  displayName: "Ben",
  origin: null,
};
const cleo = {
  key: "local:22222222-2222-4222-8222-222222222222",
  kind: "local" as const,
  username: "cleo",
  displayName: "Cleo",
  origin: null,
};
const far = {
  key: "remote:https://far.example/ann",
  kind: "remote" as const,
  username: "ann",
  displayName: "Ann",
  origin: "https://far.example",
};

describe("BoardsSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a named group from the people the reader can see", async () => {
    const onChanged = vi.fn();
    render(
      <BoardsSection
        boards={[]}
        people={[{ person: ben, mine: null, theirs: { status: "accepted" } }]}
        onChanged={onChanged}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "boards.create" }));
    fireEvent.change(await screen.findByLabelText("boards.name"), { target: { value: "Familie" } });
    fireEvent.click(screen.getByRole("button", { name: "Ben" }));
    fireEvent.click(screen.getByRole("button", { name: "boards.save" }));
    await waitFor(() =>
      expect(comparisonApi.saveBoard).toHaveBeenCalledWith(
        { name: "Familie", members: [ben.key] },
        undefined
      )
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("offers accepted people and remote friends, never a pending person", async () => {
    render(
      <BoardsSection
        boards={[]}
        people={[
          { person: ben, mine: null, theirs: { status: "accepted" } },
          { person: cleo, mine: null, theirs: { status: "pending" } },
          {
            person: far,
            mine: { consentId: "c-9", status: "accepted", scope: null },
            theirs: null,
          },
        ]}
        onChanged={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "boards.create" }));
    expect(await screen.findByRole("button", { name: "Ben" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ann" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cleo" })).toBeNull();
  });

  it("asks before deleting a group", async () => {
    const onChanged = vi.fn();
    render(
      <BoardsSection
        boards={[{ id: "b-1", name: "Familie", members: [ben.key] }]}
        people={[{ person: ben, mine: null, theirs: { status: "accepted" } }]}
        onChanged={onChanged}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "boards.delete" }));
    expect(comparisonApi.deleteBoard).not.toHaveBeenCalled();
    // A real pointer click: it fails if an overlay sits on the confirm button.
    await userEvent.click(await screen.findByRole("button", { name: "boards.deleteConfirm" }));
    await waitFor(() => expect(comparisonApi.deleteBoard).toHaveBeenCalledWith("b-1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("shows a failed save inside the open dialog", async () => {
    vi.mocked(comparisonApi.saveBoard).mockRejectedValueOnce(new Error("boom"));
    render(
      <BoardsSection
        boards={[]}
        people={[{ person: ben, mine: null, theirs: { status: "accepted" } }]}
        onChanged={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "boards.create" }));
    fireEvent.change(await screen.findByLabelText("boards.name"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "boards.save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("error.unknown");
    expect(screen.getByLabelText("boards.name")).toBeInTheDocument();
  });

  it("drops a failed save's message when the dialog is closed", async () => {
    vi.mocked(comparisonApi.saveBoard).mockRejectedValueOnce(new Error("boom"));
    render(
      <BoardsSection
        boards={[]}
        people={[{ person: ben, mine: null, theirs: { status: "accepted" } }]}
        onChanged={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "boards.create" }));
    fireEvent.change(await screen.findByLabelText("boards.name"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "boards.save" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.cancel" }));
    await waitFor(() => expect(screen.queryByLabelText("boards.name")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never prints a raw person key for a member who no longer shares", () => {
    render(
      <BoardsSection
        boards={[{ id: "b-1", name: "Familie", members: [ben.key, cleo.key] }]}
        people={[{ person: ben, mine: null, theirs: { status: "accepted" } }]}
        onChanged={vi.fn()}
      />
    );
    expect(screen.queryByText(/local:|remote:/)).toBeNull();
    expect(screen.getByText("Ben, boards.memberGone")).toBeInTheDocument();
  });
});
