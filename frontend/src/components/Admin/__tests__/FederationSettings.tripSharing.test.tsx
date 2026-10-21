import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import FederationSettings from "../FederationSettings";
import { federationAdminApi, type FederationState } from "../../../lib/api/federationAdmin";

let betaOpen = false;
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    betaFeaturesEnabled: betaOpen,
    isFeatureVisible: (key: string) => betaOpen && key === "federatedTripSharing",
  }),
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/api/federationAdmin", async (original) => ({
  ...(await original<typeof import("../../../lib/api/federationAdmin")>()),
  federationAdminApi: {
    get: vi.fn(),
    update: vi.fn(),
    setTripSharing: vi.fn(),
    generateKey: vi.fn(),
    pinPeer: vi.fn(),
    verifyPeer: vi.fn(),
    suspendPeer: vi.fn(),
  },
}));

const withKey: FederationState = {
  source: "env",
  enabled: true,
  origin: "https://me.example",
  publicKey: null,
  fingerprint: "ab".repeat(32),
  tripSharingEnabled: false,
  peers: [],
};

/** Admin → Instanz: the trip-sharing switch (spec 2026-10-20 F8), behind its beta key. */
describe("FederationSettings — trip sharing across servers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers no switch while the beta key is closed", async () => {
    betaOpen = false;
    vi.mocked(federationAdminApi.get).mockResolvedValue(withKey);
    render(<FederationSettings />);
    expect(await screen.findByText("ab".repeat(32))).toBeInTheDocument();
    expect(screen.queryByLabelText("federation.tripSharing")).toBeNull();
  });

  it("switches it on, also while FEDERATION_* holds the identity", async () => {
    betaOpen = true;
    vi.mocked(federationAdminApi.get).mockResolvedValue(withKey);
    vi.mocked(federationAdminApi.setTripSharing).mockResolvedValue({
      ...withKey,
      tripSharingEnabled: true,
    });
    render(<FederationSettings />);
    fireEvent.click(await screen.findByLabelText("federation.tripSharing"));
    await waitFor(() => expect(federationAdminApi.setTripSharing).toHaveBeenCalledWith(true));
  });
});
