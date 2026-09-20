import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ setConsent: vi.fn(), get: vi.fn(), addToast: vi.fn() }));

vi.mock("../../lib/api", () => ({
  usageStatsApi: { setConsent: mocks.setConsent, get: mocks.get },
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (state: { addToast: typeof mocks.addToast }) => unknown) =>
    selector({ addToast: mocks.addToast }),
}));

import UsageStatsConsentDialog from "../UsageStatsConsentDialog";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setConsent.mockResolvedValue({
    consent: "granted",
    installId: "x",
    endpointConfigured: true,
  });
});

describe("UsageStatsConsentDialog", () => {
  it("renders nothing when closed", () => {
    render(<UsageStatsConsentDialog isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is a dialog of its own, named for the question it asks", () => {
    render(<UsageStatsConsentDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("usageStats:consent.title");
  });

  it("offers the same two answers the card always did", () => {
    render(<UsageStatsConsentDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "usageStats:consent.accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "usageStats:consent.decline" })).toBeInTheDocument();
  });

  /**
   * The dialog's accessible name already carries these words. A second
   * heading under it reads as an echo, not as a level.
   */
  it("does not repeat its own title as a heading inside the body", () => {
    render(<UsageStatsConsentDialog isOpen onClose={vi.fn()} />);
    expect(screen.getAllByText("usageStats:consent.title")).toHaveLength(1);
    expect(
      screen.queryByRole("heading", { level: 3, name: "usageStats:consent.title" })
    ).not.toBeInTheDocument();
  });

  it("persists the answer through the card's own API call and then closes", async () => {
    const onClose = vi.fn();
    render(<UsageStatsConsentDialog isOpen onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "usageStats:consent.accept" }));
    expect(mocks.setConsent).toHaveBeenCalledWith("granted");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("persists a refusal too — declining is an answer", async () => {
    const onClose = vi.fn();
    mocks.setConsent.mockResolvedValue({
      consent: "denied",
      installId: "x",
      endpointConfigured: true,
    });
    render(<UsageStatsConsentDialog isOpen onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "usageStats:consent.decline" }));
    expect(mocks.setConsent).toHaveBeenCalledWith("denied");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * Consent that cannot be deferred is not consent. Closing records nothing,
   * so the answer stays `unset` and the step returns on the next load.
   */
  it("can be closed without answering, and records nothing when it is", async () => {
    const onClose = vi.fn();
    render(<UsageStatsConsentDialog isOpen onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.close" }));
    expect(mocks.setConsent).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
