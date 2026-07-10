import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ setConsent: vi.fn(), addToast: vi.fn() }));

vi.mock("../../lib/api", () => ({
  usageStatsApi: { setConsent: mocks.setConsent, get: vi.fn() },
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (state: { addToast: typeof mocks.addToast }) => unknown) =>
    selector({ addToast: mocks.addToast }),
}));

import UsageStatsConsentCard from "../UsageStatsConsentCard";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setConsent.mockResolvedValue({ consent: "granted", installId: "x", endpointConfigured: true });
});

describe("UsageStatsConsentCard", () => {
  it("offers both choices", () => {
    render(<UsageStatsConsentCard />);
    expect(screen.getByRole("button", { name: "usageStats:consent.accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "usageStats:consent.decline" })).toBeInTheDocument();
  });

  it("gives accept and decline identical styling — no dark pattern", () => {
    render(<UsageStatsConsentCard />);
    const accept = screen.getByRole("button", { name: "usageStats:consent.accept" });
    const decline = screen.getByRole("button", { name: "usageStats:consent.decline" });
    // Both must match: className alone would let an inline style re-introduce a
    // visual hierarchy, which is precisely the dark pattern GDPR Art. 7 forbids.
    expect(accept.className).toBe(decline.className);
    expect(accept.getAttribute("style")).toBe(decline.getAttribute("style"));
  });

  it("persists nothing when the card is merely unmounted without a choice", () => {
    const { unmount } = render(<UsageStatsConsentCard />);
    unmount();
    expect(mocks.setConsent).not.toHaveBeenCalled();
  });

  it("sends granted and reports the decision upward", async () => {
    const onDecided = vi.fn();
    render(<UsageStatsConsentCard onDecided={onDecided} />);
    await userEvent.click(screen.getByRole("button", { name: "usageStats:consent.accept" }));
    expect(mocks.setConsent).toHaveBeenCalledWith("granted");
    expect(onDecided).toHaveBeenCalledWith("granted");
  });

  it("sends denied", async () => {
    render(<UsageStatsConsentCard />);
    await userEvent.click(screen.getByRole("button", { name: "usageStats:consent.decline" }));
    expect(mocks.setConsent).toHaveBeenCalledWith("denied");
  });

  it("links to the transparency docs page", () => {
    render(<UsageStatsConsentCard />);
    const link = screen.getByRole("link", { name: "usageStats:consent.whatIsSent" });
    expect(link).toHaveAttribute("href", "https://travstats.de/docs/usage-statistics");
  });

  it("does NOT report the decision when the request fails — the card stays mounted to retry", async () => {
    mocks.setConsent.mockRejectedValue(new Error("offline"));
    const onDecided = vi.fn();
    render(<UsageStatsConsentCard onDecided={onDecided} />);
    await userEvent.click(screen.getByRole("button", { name: "usageStats:consent.decline" }));
    expect(onDecided).not.toHaveBeenCalled();
    expect(mocks.addToast).toHaveBeenCalledWith("error", "usageStats:consent.saveFailed");
    // Buttons remain — the admin can retry instead of the choice silently vanishing.
    expect(
      screen.getByRole("button", { name: "usageStats:consent.decline" })
    ).toBeInTheDocument();
  });

  it("in setup variant it defers the API call to the parent", async () => {
    const onDecided = vi.fn();
    render(<UsageStatsConsentCard variant="setup" onDecided={onDecided} />);
    await userEvent.click(screen.getByRole("button", { name: "usageStats:consent.accept" }));
    expect(mocks.setConsent).not.toHaveBeenCalled();
    expect(onDecided).toHaveBeenCalledWith("granted");
  });
});
