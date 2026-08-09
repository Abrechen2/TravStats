import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  availability: vi.fn(),
  list: vi.fn(),
  registerOptions: vi.fn(),
  registerVerify: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}));
const startRegistration = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/api", () => ({ passkeyApi: api }));
vi.mock("@simplewebauthn/browser", () => ({ startRegistration }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import PasskeySection from "../PasskeySection";

describe("PasskeySection", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    startRegistration.mockReset();
    api.availability.mockResolvedValue({ available: true, reason: null });
    api.list.mockResolvedValue([]);
  });

  it("offers to add a passkey when the origin supports it", async () => {
    render(<PasskeySection />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "settings:passkeys.add" })).toBeInTheDocument()
    );
  });

  // An insecure origin cannot do WebAuthn at all. Drawing a button that always
  // throws a browser error is worse than saying why.
  it("explains itself instead of offering a button on an insecure origin", async () => {
    api.availability.mockResolvedValue({ available: false, reason: "insecureOrigin" });
    render(<PasskeySection />);

    await waitFor(() =>
      expect(screen.getByText("settings:passkeys.insecureOrigin")).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: "settings:passkeys.add" })).toBeNull();
  });

  it("says so when nothing is configured yet", async () => {
    api.availability.mockResolvedValue({ available: false, reason: "notConfigured" });
    render(<PasskeySection />);
    await waitFor(() =>
      expect(screen.getByText("settings:passkeys.notConfigured")).toBeInTheDocument()
    );
  });

  it("lists registered keys with the RP ID they belong to", async () => {
    api.list.mockResolvedValue([
      {
        id: "p1",
        name: "Bitwarden",
        rpId: "trav.example.com",
        createdAt: "2026-08-09T10:00:00.000Z",
        lastUsedAt: null,
      },
    ]);
    render(<PasskeySection />);

    await waitFor(() => expect(screen.getByText("Bitwarden")).toBeInTheDocument());
    expect(screen.getByText(/trav\.example\.com/)).toBeInTheDocument();
  });

  it("runs the browser ceremony and stores the key under the typed name", async () => {
    api.registerOptions.mockResolvedValue({ challenge: "c" });
    startRegistration.mockResolvedValue({ id: "cred-1" });
    api.registerVerify.mockResolvedValue({ id: "p1", name: "Bitwarden" });
    render(<PasskeySection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings:passkeys.add" }));
    fireEvent.change(await screen.findByLabelText("settings:passkeys.nameLabel"), {
      target: { value: "Bitwarden" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:passkeys.confirmAdd" }));

    await waitFor(() => expect(startRegistration).toHaveBeenCalled());
    await waitFor(() =>
      expect(api.registerVerify).toHaveBeenCalledWith("Bitwarden", { id: "cred-1" })
    );
  });

  // Cancelling the OS/manager dialog throws — that is a normal thing for a user
  // to do and must not read as a failure.
  it("stays quiet when the user cancels the browser dialog", async () => {
    api.registerOptions.mockResolvedValue({ challenge: "c" });
    startRegistration.mockRejectedValue(
      Object.assign(new Error("cancelled"), { name: "NotAllowedError" })
    );
    render(<PasskeySection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings:passkeys.add" }));
    fireEvent.change(await screen.findByLabelText("settings:passkeys.nameLabel"), {
      target: { value: "Phone" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:passkeys.confirmAdd" }));

    await waitFor(() => expect(startRegistration).toHaveBeenCalled());
    expect(api.registerVerify).not.toHaveBeenCalled();
    expect(screen.queryByText("settings:passkeys.addFailed")).toBeNull();
  });

  it("reports a genuine failure", async () => {
    api.registerOptions.mockResolvedValue({ challenge: "c" });
    startRegistration.mockRejectedValue(new Error("boom"));
    render(<PasskeySection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings:passkeys.add" }));
    fireEvent.change(await screen.findByLabelText("settings:passkeys.nameLabel"), {
      target: { value: "Phone" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:passkeys.confirmAdd" }));

    await waitFor(() =>
      expect(screen.getByText("settings:passkeys.addFailed")).toBeInTheDocument()
    );
  });

  it("removes a key", async () => {
    api.list.mockResolvedValue([
      {
        id: "p1",
        name: "Bitwarden",
        rpId: "trav.example.com",
        createdAt: "2026-08-09T10:00:00.000Z",
        lastUsedAt: null,
      },
    ]);
    api.remove.mockResolvedValue(undefined);
    render(<PasskeySection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings:passkeys.remove" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("p1"));
  });
});
