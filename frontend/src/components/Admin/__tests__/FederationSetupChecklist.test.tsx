import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import FederationRows from "../../Services/FederationRows";
import { federationAdminApi, type FederationState } from "../../../lib/api/federationAdmin";

/**
 * Admin → Instanz: the setup checklist for sharing trips across servers (owner 2026-10-26, "der
 * Server zu Server Verbindungsteil ist nicht ganz klar"). Each prerequisite shows its live
 * state, and each open one a button to the exact control that fixes it.
 */
let betaOpen = true;
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
    admissions: vi.fn().mockResolvedValue([]),
    suspendPeer: vi.fn(),
  },
}));

const FP = "ab".repeat(32);
const PEER = "https://far.example";
const done: FederationState = {
  source: "settings",
  enabled: true,
  origin: "https://me.example",
  publicKey: null,
  fingerprint: FP,
  hasKey: true,
  tripSharingEnabled: true,
  peers: [
    {
      origin: PEER,
      fingerprint: "cd".repeat(32),
      enabled: true,
      verifiedAt: "2026-10-25T10:00:00.000Z",
      leaderboardVersions: [1],
    },
  ],
};

async function checklist(state: FederationState): Promise<HTMLElement> {
  vi.mocked(federationAdminApi.get).mockResolvedValue(state);
  render(<FederationRows />);
  return screen.findByTestId("federation-checklist");
}
const step = (n: number) => screen.getByTestId(`federation-step-${n}`);

describe("FederationRows — setup checklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    betaOpen = true;
  });

  it("is absent while the beta key is closed", async () => {
    betaOpen = false;
    vi.mocked(federationAdminApi.get).mockResolvedValue(done);
    render(<FederationRows />);
    expect(await screen.findByText(FP)).toBeInTheDocument();
    expect(screen.queryByTestId("federation-checklist")).toBeNull();
  });

  it("is all done: address and fingerprint with copy buttons, switch on", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await checklist(done);
    for (const n of [1, 2]) expect(step(n)).toHaveAttribute("data-done", "true");
    fireEvent.click(
      within(step(1)).getByRole("button", { name: "federation.checklist.copyOrigin" })
    );
    fireEvent.click(
      within(step(1)).getByRole("button", { name: "federation.checklist.copyFingerprint" })
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FP));
    expect(writeText).toHaveBeenCalledWith("https://me.example");
  });

  it.each([
    ["missing origin", { origin: null }, "noOrigin", "federation-origin"],
    ["missing key", { hasKey: false }, "noKey", "federation-generate-key"],
    ["federation off", { enabled: false }, "federationOff", "federation-enabled"],
  ] as const)("names a %s and leads to its control", async (_label, over, reason, target) => {
    await checklist({ ...done, ...over, fingerprint: null });
    expect(step(1)).toHaveAttribute("data-done", "false");
    expect(step(1)).toHaveTextContent(`federation.checklist.identity.${reason}`);
    fireEvent.click(within(step(1)).getByRole("button", { name: "federation.checklist.fix" }));
    expect(document.activeElement?.id).toBe(target);
  });

  it("switch off: the button turns it on", async () => {
    vi.mocked(federationAdminApi.setTripSharing).mockResolvedValue(done);
    await checklist({ ...done, tripSharingEnabled: false });
    expect(step(2)).toHaveAttribute("data-done", "false");
    fireEvent.click(within(step(2)).getByRole("button", { name: "federation.checklist.switchOn" }));
    await waitFor(() => expect(federationAdminApi.setTripSharing).toHaveBeenCalledWith(true));
  });

  it("switch off without an identity: the button waits for step 1", async () => {
    await checklist({ ...done, fingerprint: null, enabled: false, tripSharingEnabled: false });
    expect(
      within(step(2)).getByRole("button", { name: "federation.checklist.switchOn" })
    ).toBeDisabled();
  });
});
