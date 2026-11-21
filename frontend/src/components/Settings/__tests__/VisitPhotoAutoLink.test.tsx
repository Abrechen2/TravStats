import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import VisitPhotoAutoLink from "../VisitPhotoAutoLink";

const getAutoLinkStatus = vi.fn();
const setAutoLinkEnabled = vi.fn();
vi.mock("../../../lib/api/places", () => ({
  getAutoLinkStatus: () => getAutoLinkStatus(),
  setAutoLinkEnabled: (...a: unknown[]) => setAutoLinkEnabled(...a),
}));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => true }),
}));

describe("VisitPhotoAutoLink", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the switch on by default and sends the new state when it is turned off", async () => {
    getAutoLinkStatus.mockResolvedValue({ enabled: true, lastRun: null });
    setAutoLinkEnabled.mockResolvedValue(undefined);
    render(<VisitPhotoAutoLink />);
    const box = await screen.findByRole("checkbox");
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(setAutoLinkEnabled).toHaveBeenCalledWith(false);
  });

  it("names the source whose last pass failed instead of saying nothing", async () => {
    getAutoLinkStatus.mockResolvedValue({
      enabled: true,
      lastRun: {
        at: "2026-11-21T10:00:00Z",
        linked: 0,
        sources: { immich: "ok", photoprism: "auth" },
      },
    });
    render(<VisitPhotoAutoLink />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("visitPhotosAuto.source.photoprism");
  });
});
