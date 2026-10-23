import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AxiosError } from "axios";
import { describe, it, expect, vi, beforeEach } from "vitest";
import FederationSettings from "../FederationSettings";
import { federationAdminApi, type FederationState } from "../../../lib/api/federationAdmin";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/api/federationAdmin", async (original) => ({
  ...(await original<typeof import("../../../lib/api/federationAdmin")>()),
  federationAdminApi: {
    get: vi.fn(),
    update: vi.fn(),
    generateKey: vi.fn(),
    pinPeer: vi.fn(),
    verifyPeer: vi.fn(),
    suspendPeer: vi.fn(),
  },
}));

const base: FederationState = {
  source: null,
  enabled: true,
  origin: "https://me.example",
  publicKey: null,
  fingerprint: null,
  tripSharingEnabled: false,
  peers: [],
};

/** A refusal the way the API sends it: a status and a stable code in the body. */
function refusal(status: number, code?: string): AxiosError {
  const error = new AxiosError("refused");
  error.response = {
    status,
    data: code ? { error: "prose", code } : { error: "prose" },
    statusText: "",
    headers: {},
    config: { headers: {} } as never,
  };
  return error;
}

describe("FederationSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates the server key from the UI and shows the fingerprint to hand on", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue(base);
    vi.mocked(federationAdminApi.generateKey).mockResolvedValue({
      ...base,
      source: "settings",
      publicKey: "-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----\n",
      fingerprint: "ab".repeat(32),
    });
    render(<FederationSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "federation.generateKey" }));
    expect(await screen.findByText("ab".repeat(32))).toBeInTheDocument();
    expect(federationAdminApi.generateKey).toHaveBeenCalledTimes(1);
  });

  it("is read-only while the env override holds the identity", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue({
      ...base,
      source: "env",
      fingerprint: "cd".repeat(32),
    });
    render(<FederationSettings />);
    expect(await screen.findByText("federation.envNote")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "federation.generateKey" })).toBeNull();
  });

  it("pins a peer from origin, key and fingerprint", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue({
      ...base,
      source: "settings",
      fingerprint: "ef".repeat(32),
    });
    vi.mocked(federationAdminApi.pinPeer).mockResolvedValue(base);
    render(<FederationSettings />);
    fireEvent.change(await screen.findByLabelText("federation.peerOrigin"), {
      target: { value: "https://friend.example" },
    });
    fireEvent.change(screen.getByLabelText("federation.peerKey"), { target: { value: "KEY" } });
    fireEvent.change(screen.getByLabelText("federation.peerFingerprint"), {
      target: { value: "12".repeat(32) },
    });
    fireEvent.click(screen.getByRole("button", { name: "federation.pin" }));
    await waitFor(() =>
      expect(federationAdminApi.pinPeer).toHaveBeenCalledWith({
        origin: "https://friend.example",
        publicKey: "KEY",
        fingerprint: "12".repeat(32),
        enabled: true,
      })
    );
    // Settle on the state after the call (the key leaves the fresh state with no fingerprint,
    // so the pin form is gone) rather than leave the update to land outside act().
    await waitFor(() => expect(screen.queryByLabelText("federation.peerKey")).toBeNull());
  });

  it("takes the peer key in a multi-line field and sends a pasted PEM intact", async () => {
    const pem = ["-----BEGIN PUBLIC KEY-----", "AAA", "BBB", "-----END PUBLIC KEY-----", ""].join(
      "\n"
    );
    vi.mocked(federationAdminApi.get).mockResolvedValue({
      ...base,
      source: "settings",
      fingerprint: "ef".repeat(32),
    });
    vi.mocked(federationAdminApi.pinPeer).mockResolvedValue(base);
    render(<FederationSettings />);
    const key = await screen.findByLabelText("federation.peerKey");
    expect(key.tagName).toBe("TEXTAREA");
    fireEvent.change(screen.getByLabelText("federation.peerOrigin"), {
      target: { value: "https://friend.example" },
    });
    fireEvent.change(key, { target: { value: pem } });
    fireEvent.change(screen.getByLabelText("federation.peerFingerprint"), {
      target: { value: "12".repeat(32) },
    });
    fireEvent.click(screen.getByRole("button", { name: "federation.pin" }));
    await waitFor(() =>
      expect(federationAdminApi.pinPeer).toHaveBeenCalledWith(
        expect.objectContaining({ publicKey: pem })
      )
    );
    await waitFor(() => expect(screen.queryByLabelText("federation.peerKey")).toBeNull());
  });

  it("does not report a verify as failed when only the refresh afterwards fails", async () => {
    const withPeer: FederationState = {
      ...base,
      source: "settings",
      fingerprint: "ef".repeat(32),
      peers: [
        {
          origin: "https://friend.example",
          fingerprint: "12".repeat(32),
          enabled: true,
          verifiedAt: null,
          leaderboardVersions: [],
        },
      ],
    };
    vi.mocked(federationAdminApi.get)
      .mockResolvedValueOnce(withPeer)
      .mockRejectedValueOnce(refusal(500));
    vi.mocked(federationAdminApi.verifyPeer).mockResolvedValue(undefined);
    render(<FederationSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "federation.verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("federation.error.refresh");
    expect(screen.getByRole("alert")).not.toHaveTextContent("federation.error.generic");
  });

  describe("tells the failure kinds apart", () => {
    const withIdentity: FederationState = {
      ...base,
      source: "settings",
      fingerprint: "ef".repeat(32),
      peers: [
        {
          origin: "https://friend.example",
          fingerprint: "12".repeat(32),
          enabled: true,
          verifiedAt: null,
          leaderboardVersions: [],
        },
      ],
    };

    it("names a wrong key or fingerprint when pinning", async () => {
      vi.mocked(federationAdminApi.get).mockResolvedValue(withIdentity);
      vi.mocked(federationAdminApi.pinPeer).mockRejectedValue(
        refusal(400, "COMPARISON_PEER_KEY_INVALID")
      );
      render(<FederationSettings />);
      fireEvent.change(await screen.findByLabelText("federation.peerOrigin"), {
        target: { value: "https://friend.example" },
      });
      fireEvent.change(screen.getByLabelText("federation.peerKey"), { target: { value: "KEY" } });
      fireEvent.change(screen.getByLabelText("federation.peerFingerprint"), {
        target: { value: "00" },
      });
      fireEvent.click(screen.getByRole("button", { name: "federation.pin" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "federation.error.COMPARISON_PEER_KEY_INVALID"
      );
    });

    it("names an unreachable peer when verifying", async () => {
      vi.mocked(federationAdminApi.get).mockResolvedValue(withIdentity);
      vi.mocked(federationAdminApi.verifyPeer).mockRejectedValue(
        refusal(502, "COMPARISON_PEER_UNREACHABLE")
      );
      render(<FederationSettings />);
      fireEvent.click(await screen.findByRole("button", { name: "federation.verify" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "federation.error.COMPARISON_PEER_UNREACHABLE"
      );
    });

    it("names an env-managed identity when a save is refused", async () => {
      vi.mocked(federationAdminApi.get).mockResolvedValue(withIdentity);
      vi.mocked(federationAdminApi.generateKey).mockRejectedValue(
        refusal(409, "COMPARISON_FEDERATION_ENV")
      );
      render(<FederationSettings />);
      fireEvent.click(await screen.findByRole("button", { name: "federation.generateKey" }));
      // A key exists, so the replacement is asked first.
      fireEvent.click(
        await screen.findByRole("button", { name: "federation.rotateConfirm.confirm" })
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "federation.error.COMPARISON_FEDERATION_ENV"
      );
    });

    it("names an unknown peer", async () => {
      vi.mocked(federationAdminApi.get).mockResolvedValue(withIdentity);
      vi.mocked(federationAdminApi.suspendPeer).mockRejectedValue(
        refusal(404, "COMPARISON_PEER_UNKNOWN")
      );
      render(<FederationSettings />);
      fireEvent.click(await screen.findByRole("button", { name: "federation.suspend" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "federation.error.COMPARISON_PEER_UNKNOWN"
      );
    });

    it("falls back to the generic message only for a failure it has no code for", async () => {
      vi.mocked(federationAdminApi.get).mockResolvedValue(withIdentity);
      vi.mocked(federationAdminApi.verifyPeer).mockRejectedValue(refusal(500));
      render(<FederationSettings />);
      fireEvent.click(await screen.findByRole("button", { name: "federation.verify" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("federation.error.generic");
    });
  });
});
