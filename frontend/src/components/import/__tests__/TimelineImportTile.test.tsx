import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const caps = vi.hoisted(() => ({ value: null as unknown }));
const navigate = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const admin = vi.hoisted(() => ({ value: false }));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../hooks/useTravTrackVisible", () => ({
  useTravTrackCapabilities: () => caps.value,
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../store/authStore", () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { isAdmin: admin.value } }),
}));
vi.mock("../../ui/settings", () => ({
  useGuardedNavigate: () => navigate,
  JumpControl: ({ label, onJump }: { label: string; onJump: () => void }) => (
    <button onClick={onJump}>{label}</button>
  ),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../lib/api/client", () => ({
  default: { post, get: vi.fn() },
  api: { post, get: vi.fn() },
}));
vi.mock("../../../lib/api/travtrackImports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrackImports")>()),
  travTrackImportsApi: {
    list: vi.fn().mockResolvedValue([]),
    importGpx: vi.fn().mockResolvedValue({
      status: "succeeded",
      report: {
        read: 1,
        stored: 1,
        duplicate: 0,
        dropped: { privacy_zone: 0, deleted_range: 0, invalid: 0, null_island: 0 },
        withoutTime: 0,
      },
    }),
  },
}));

import { TimelineImportTile } from "../TimelineImportTile";
import { travTrackImportsApi } from "../../../lib/api/travtrackImports";

describe("TimelineImportTile", () => {
  beforeEach(() => {
    navigate.mockReset();
    admin.value = false;
    caps.value = { version: 1, offered: true, enabled: true, active: true, hasData: false };
  });

  it("renders the Timeline copy and hands a chosen file to the TravTrack import", async () => {
    const { container } = render(<TimelineImportTile />);
    expect(screen.getByText("settings:import.timeline.title")).toBeInTheDocument();
    expect(screen.getByText("settings:import.timeline.description")).toBeInTheDocument();
    // The embedded TravTrack importer, without a second heading of its own.
    expect(screen.queryByText("track:imports.title")).toBeNull();
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["{}"], "Timeline.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(travTrackImportsApi.importGpx).toHaveBeenCalledWith(file, expect.any(Function))
    );
  });

  it("says TravTrack is off instead of hiding, and offers the switch to an admin only", () => {
    caps.value = { version: 1, offered: true, enabled: false, active: false, hasData: false };
    const { container, rerender } = render(<TimelineImportTile />);
    expect(screen.getByTestId("timeline-tile-note")).toHaveTextContent(
      "settings:import.timeline.off"
    );
    expect(container.querySelector("input[type=file]")).toBeNull();
    expect(screen.queryByText("settings:import.timeline.offAdmin")).toBeNull();
    expect(screen.getByText("settings:import.timeline.offMember")).toBeInTheDocument();
    admin.value = true;
    rerender(<TimelineImportTile />);
    fireEvent.click(screen.getByText("settings:import.timeline.offAdmin"));
    expect(navigate).toHaveBeenCalledWith("/settings/tt-bereit");
  });

  it("points to the TravTrack import settings", async () => {
    render(<TimelineImportTile />);
    fireEvent.click(await screen.findByText("settings:import.timeline.toTravTrack"));
    await waitFor(() => expect(travTrackImportsApi.list).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/settings/tt-daten");
  });

  it("says so when TravTrack's state could not be read", () => {
    caps.value = null;
    render(<TimelineImportTile />);
    expect(screen.getByTestId("timeline-tile-note")).toHaveTextContent(
      "settings:import.timeline.unknown"
    );
  });
});

describe("importGpx upload target", () => {
  it("is the TravTrack import endpoint the Settings card uses", async () => {
    const real = await vi.importActual<typeof import("../../../lib/api/travtrackImports")>(
      "../../../lib/api/travtrackImports"
    );
    post.mockRejectedValueOnce(new Error("stop"));
    await expect(real.travTrackImportsApi.importGpx(new File(["x"], "a.json"))).rejects.toThrow();
    expect(post.mock.calls[0][0]).toBe("/travtrack/imports");
  });
});
