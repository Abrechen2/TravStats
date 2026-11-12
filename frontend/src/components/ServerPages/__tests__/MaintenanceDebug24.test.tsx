import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import MaintenanceDebug24, { remainingParts } from "../MaintenanceDebug24";
import type { LoggingConfigResponse } from "../../../shared/logContract";

const admin = vi.hoisted(() => ({ toggleDebugLogging: vi.fn() }));
vi.mock("../../../lib/api", () => ({ adminApi: admin }));
// Here the numbers must show: the key-echo mock of the other suites would swallow them.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && !("defaultValue" in options) ? `${key} ${JSON.stringify(options)}` : key,
    i18n: undefined,
  }),
}));
vi.mock("../../../lib/displayFormat", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/displayFormat")>()),
  useDisplayFormat: () => ({ dateTime: (iso: string) => `at(${iso})` }),
}));

const NOW = Date.parse("2026-11-11T12:00:00Z");
const config = (over: Partial<LoggingConfigResponse> = {}): LoggingConfigResponse =>
  ({
    logLevel: "info",
    effectiveLogLevel: "info",
    logLevelSource: "settings",
    maxLogFileSize: 1,
    maxLogFiles: 1,
    logHttpRequests: false,
    logDatabaseQueries: false,
    logParserOperations: false,
    logRetentionDays: 7,
    debugUntil: null,
    ...over,
  }) as LoggingConfigResponse;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("remainingParts", () => {
  it("counts whole hours and minutes, rounding a started minute up and never going negative", () => {
    expect(remainingParts(NOW + 23 * 3_600_000 + 14 * 60_000, NOW)).toEqual({
      hours: 23,
      minutes: 14,
    });
    expect(remainingParts(NOW + 30_000, NOW)).toEqual({ hours: 0, minutes: 1 });
    expect(remainingParts(NOW - 5_000, NOW)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe("Wartung › Ausführliches Protokoll für 24 h", () => {
  it("offers the switch-on while no timer runs, and shows no countdown", () => {
    render(<MaintenanceDebug24 config={config()} reload={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "settingsRows:maintenance.debug24.btn" })
    ).toBeEnabled();
    expect(document.querySelector("[data-debug24]")).toBeNull();
  });

  it("starts the timer on the server and reloads, so the countdown is the server's, not a guess", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    admin.toggleDebugLogging.mockResolvedValue({ message: "ok", config: config() });
    render(<MaintenanceDebug24 config={config()} reload={reload} />);
    await act(async () => {
      screen.getByRole("button", { name: "settingsRows:maintenance.debug24.btn" }).click();
    });
    expect(admin.toggleDebugLogging).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows until when it runs and how much is left, and counts down as time passes", () => {
    const until = new Date(NOW + 23 * 3_600_000 + 14 * 60_000).toISOString();
    render(<MaintenanceDebug24 config={config({ debugUntil: until })} reload={vi.fn()} />);
    const line = document.querySelector("[data-debug24='running']") as HTMLElement;
    expect(line).toHaveTextContent('"hours":23,"minutes":14');
    expect(line).toHaveTextContent(`"until":"at(${until})"`);
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(document.querySelector("[data-debug24='running']")).toHaveTextContent(
      '"hours":23,"minutes":4'
    );
  });

  it("offers the way back while it runs, and ends the timer on the server", async () => {
    const until = new Date(NOW + 3_600_000).toISOString();
    const reload = vi.fn().mockResolvedValue(undefined);
    admin.toggleDebugLogging.mockResolvedValue({ message: "ok", config: config() });
    render(<MaintenanceDebug24 config={config({ debugUntil: until })} reload={reload} />);
    expect(
      screen.queryByRole("button", { name: "settingsRows:maintenance.debug24.btn" })
    ).toBeNull();
    await act(async () => {
      screen.getByRole("button", { name: "settingsRows:maintenance.debug24.off" }).click();
    });
    expect(admin.toggleDebugLogging).toHaveBeenCalledWith(false);
  });

  it("reads a timer that has run out as off: the server puts the level back by itself", () => {
    const until = new Date(NOW - 60_000).toISOString();
    render(<MaintenanceDebug24 config={config({ debugUntil: until })} reload={vi.fn()} />);
    expect(document.querySelector("[data-debug24]")).toBeNull();
    expect(
      screen.getByRole("button", { name: "settingsRows:maintenance.debug24.btn" })
    ).toBeInTheDocument();
  });

  it("keeps the countdown off and says so when the server refuses", async () => {
    admin.toggleDebugLogging.mockRejectedValue(new Error("refused"));
    render(<MaintenanceDebug24 config={config()} reload={vi.fn()} />);
    await act(async () => {
      screen.getByRole("button", { name: "settingsRows:maintenance.debug24.btn" }).click();
    });
    expect(screen.getByText("settingsRows:maintenance.debug24.failed")).toBeInTheDocument();
    expect(document.querySelector("[data-debug24]")).toBeNull();
  });

  it("shows the fresh countdown from the toggle's own answer when the reload that follows fails", async () => {
    const until = new Date(NOW + 24 * 3_600_000).toISOString();
    admin.toggleDebugLogging.mockResolvedValue({
      message: "ok",
      config: config({ debugUntil: until }),
    });
    const reload = vi.fn().mockRejectedValue(new Error("offline"));
    render(<MaintenanceDebug24 config={config()} reload={reload} />);
    await act(async () => {
      screen.getByRole("button", { name: "settingsRows:maintenance.debug24.btn" }).click();
    });
    expect(reload).toHaveBeenCalled();
    // The switch worked: the row runs, and the failed re-read is not reported as a failed switch.
    expect(document.querySelector("[data-debug24='running']")).toHaveTextContent(`at(${until})`);
    expect(screen.queryByText("settingsRows:maintenance.debug24.failed")).toBeNull();
  });
});
