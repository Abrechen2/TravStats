import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PeopleSection from "../PeopleSection";
import { comparisonApi } from "../../../lib/api/comparison";
import type { PeopleResponse } from "../../../lib/comparison/types";

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
const far = {
  key: "remote:https://far.example/ann",
  kind: "remote" as const,
  username: "ann",
  displayName: "Ann",
  origin: "https://far.example",
};
const people: PeopleResponse = {
  requests: [{ consentId: "c-1", person: ben, createdAt: "2026-10-16T00:00:00.000Z" }],
  people: [
    {
      person: ben,
      mine: { consentId: "c-2", status: "accepted", scope: SCOPE as never },
      theirs: { status: "accepted" },
    },
  ],
  boards: [],
};

describe("PeopleSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts a request with the scope chosen in the dialog", async () => {
    const onChanged = vi.fn();
    render(<PeopleSection people={people} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "requests.accept" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await waitFor(() => expect(comparisonApi.accept).toHaveBeenCalledWith("c-1", SCOPE));
    expect(onChanged).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "confirm-dialog" })).toBeNull()
    );
  });

  it("declines a request without a dialog", async () => {
    const onChanged = vi.fn();
    render(<PeopleSection people={people} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "requests.decline" }));
    await waitFor(() => expect(comparisonApi.decline).toHaveBeenCalledWith("c-1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("asks before ending, then ends with the person's key", async () => {
    const onChanged = vi.fn();
    render(<PeopleSection people={people} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "people.end" }));
    expect(comparisonApi.end).not.toHaveBeenCalled();
    // A real pointer click: it fails if an overlay sits on the confirm button.
    await userEvent.click(await screen.findByRole("button", { name: "people.endConfirm" }));
    await waitFor(() => expect(comparisonApi.end).toHaveBeenCalledWith(ben.key));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("shows a pending request as waiting and never as sharing", () => {
    const pending: PeopleResponse = {
      requests: [],
      people: [
        {
          person: ben,
          mine: { consentId: "c-3", status: "pending", scope: SCOPE as never },
          theirs: { status: "pending" },
        },
      ],
      boards: [],
    };
    render(<PeopleSection people={pending} onChanged={vi.fn()} />);
    expect(screen.getAllByText("people.waiting")).toHaveLength(2);
    expect(screen.queryByText("people.sharing")).toBeNull();
    expect(screen.queryByText("group.trips")).toBeNull();
    expect(screen.queryByRole("button", { name: "people.change" })).toBeNull();
    expect(screen.getByRole("button", { name: "people.end" })).toBeInTheDocument();
  });

  it("still offers to end a person on another server", async () => {
    const remote: PeopleResponse = {
      requests: [],
      people: [
        {
          person: far,
          mine: { consentId: "c-4", status: "accepted", scope: SCOPE as never },
          theirs: null,
        },
      ],
      boards: [],
    };
    render(<PeopleSection people={remote} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "people.end" }));
    await userEvent.click(await screen.findByRole("button", { name: "people.endConfirm" }));
    await waitFor(() => expect(comparisonApi.end).toHaveBeenCalledWith(far.key));
  });

  it("changes the scope of an accepted person through the dialog", async () => {
    render(<PeopleSection people={people} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "people.change" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await waitFor(() => expect(comparisonApi.updateScope).toHaveBeenCalledWith("c-2", SCOPE));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "confirm-dialog" })).toBeNull()
    );
  });

  it("says why an action failed", async () => {
    vi.mocked(comparisonApi.decline).mockRejectedValueOnce(new Error("boom"));
    render(<PeopleSection people={people} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "requests.decline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("error.unknown");
  });
});
