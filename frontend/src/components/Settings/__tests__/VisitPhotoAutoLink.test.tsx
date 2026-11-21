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
const setPhotoCap = vi.fn();
const trimPhotoLinks = vi.fn();
vi.mock("../../../lib/api/photoChoices", () => ({
  setPhotoCap: (...a: unknown[]) => setPhotoCap(...a),
  trimPhotoLinks: (...a: unknown[]) => trimPhotoLinks(...a),
}));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => true }),
}));

describe("VisitPhotoAutoLink", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the switch on by default and sends the new state when it is turned off", async () => {
    getAutoLinkStatus.mockResolvedValue({ enabled: true, lastRun: null });
    setAutoLinkEnabled.mockResolvedValue(null);
    render(<VisitPhotoAutoLink />);
    const box = await screen.findByRole("checkbox");
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(setAutoLinkEnabled).toHaveBeenCalledWith(false, expect.any(Function));
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

  it("follows the pass after switching on and names failed visits with their reason", async () => {
    getAutoLinkStatus.mockResolvedValue({ enabled: false, lastRun: null });
    setAutoLinkEnabled.mockImplementation(
      async (_on: boolean, onProgress?: (p: unknown) => void) => {
        onProgress?.({ done: 3, total: 10 });
        return {
          visits: 10,
          linked: 4,
          failedVisits: 1,
          failures: [{ visitId: "v1", reason: "unreachable" }],
          truncatedVisits: 2,
        };
      }
    );
    render(<VisitPhotoAutoLink />);
    const box = await screen.findByRole("checkbox");
    await waitFor(() => expect(box).toBeEnabled());
    await userEvent.click(box);
    expect(await screen.findByText("visitPhotosAuto.done")).toBeInTheDocument();
    const alerts = (await screen.findAllByRole("alert")).map((a) => a.textContent).join(" ");
    expect(alerts).toContain("visitPhotosAuto.failedVisits");
    expect(alerts).toContain("errors.unreachable");
    expect(alerts).toContain("visitPhotosAuto.truncatedVisits");
  });

  it("offers a limit of 5 to 10, saves a change and reports how many links the trim removed", async () => {
    getAutoLinkStatus.mockResolvedValue({
      enabled: true,
      lastRun: null,
      cap: 6,
      capMin: 5,
      capMax: 10,
    });
    setPhotoCap.mockResolvedValue({ trimmed: 3, checked: 9, removed: 14 });
    render(<VisitPhotoAutoLink />);
    const select = await screen.findByRole("combobox");
    await waitFor(() => expect(select).toBeEnabled());
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.value)).toEqual([
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
    await userEvent.selectOptions(select, "8");
    expect(setPhotoCap).toHaveBeenCalledWith(8, expect.any(Function));
    expect(await screen.findByText("visitPhotosAuto.trimDone")).toBeInTheDocument();
  });
});
