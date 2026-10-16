import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AddPersonCard from "../AddPersonCard";
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

const CODE = "https://far.example#" + "b".repeat(64);
const MINE = "https://me.example#" + "a".repeat(64);

describe("AddPersonCard", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("asks a person on this server by username with the dialog's scope", async () => {
    const onChanged = vi.fn();
    render(<AddPersonCard onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText("add.username"), { target: { value: "ben" } });
    fireEvent.click(screen.getByRole("button", { name: "add.ask" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await waitFor(() => expect(comparisonApi.request).toHaveBeenCalledWith("ben", SCOPE));
    expect(onChanged).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "confirm-dialog" })).toBeNull()
    );
  });

  it("creates an invitation code to pass on, and keeps it out of browser storage", async () => {
    const stored = (): string =>
      JSON.stringify([{ ...window.localStorage }, { ...window.sessionStorage }]);
    const before = stored();
    render(<AddPersonCard onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "add.createInvite" }));
    expect(await screen.findByDisplayValue(MINE)).toBeInTheDocument();
    expect(stored()).toBe(before);
    expect(stored()).not.toContain("a".repeat(64));
  });

  it("copies the invitation code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<AddPersonCard onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "add.createInvite" }));
    await screen.findByDisplayValue(MINE);
    fireEvent.click(screen.getByRole("button", { name: "add.copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MINE));
    expect(await screen.findByRole("button", { name: "add.copied" })).toBeInTheDocument();
  });

  it("redeems a code from another server through the dialog", async () => {
    render(<AddPersonCard onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("add.claimLabel"), { target: { value: CODE } });
    fireEvent.click(screen.getByRole("button", { name: "add.claim" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await waitFor(() => expect(comparisonApi.claimInvite).toHaveBeenCalledWith(CODE, SCOPE));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "confirm-dialog" })).toBeNull()
    );
  });

  it("refuses a malformed code before sending anything", () => {
    render(<AddPersonCard onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("add.claimLabel"), {
      target: { value: "https://far.example#abc" },
    });
    expect(screen.getByText("add.claimInvalid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "add.claim" })).toBeDisabled();
    expect(comparisonApi.claimInvite).not.toHaveBeenCalled();
  });

  it("names a rejected invitation request", async () => {
    vi.mocked(comparisonApi.createInvite).mockRejectedValueOnce(new Error("boom"));
    render(<AddPersonCard onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "add.createInvite" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("error.unknown");
  });

  it("keeps the button disabled for an http:// code, which the server refuses", () => {
    render(<AddPersonCard onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("add.claimLabel"), {
      target: { value: "http://far.example#" + "b".repeat(64) },
    });
    expect(screen.getByRole("button", { name: "add.claim" })).toBeDisabled();
  });

  it.each([
    ["a port", "https://far.example:8443#" + "b".repeat(64)],
    ["a path", "https://far.example/x#" + "b".repeat(64)],
    ["an upper-case host", "https://Far.Example#" + "b".repeat(64)],
  ])("keeps the button disabled for a code with %s", (_name, value) => {
    render(<AddPersonCard onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("add.claimLabel"), { target: { value } });
    expect(screen.getByRole("button", { name: "add.claim" })).toBeDisabled();
  });

  it("says so when the clipboard refuses, instead of only logging", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<AddPersonCard onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "add.createInvite" }));
    await screen.findByDisplayValue(MINE);
    fireEvent.click(screen.getByRole("button", { name: "add.copy" }));
    expect(await screen.findByText("add.copyFailed")).toBeInTheDocument();
  });
});
