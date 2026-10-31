import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import AutoUpdateSection from "../AutoUpdateSection";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

const SETTINGS = {
  enabled: true,
  requireApproval: true,
  checkInterval: 15,
  onlyDuringFlight: true,
  expiryHours: 24,
};

function renderSection(onSave = vi.fn(), onSet = vi.fn()) {
  render(
    <MemoryRouter>
      <AutoUpdateSection
        autoUpdateSettings={SETTINGS}
        loadingAutoUpdateSettings={false}
        loadState="loaded"
        onRetryLoad={vi.fn()}
        onSetAutoUpdateSettings={onSet}
        onSave={onSave}
      />
    </MemoryRouter>
  );
  return { onSave, onSet };
}

describe("AutoUpdateSection", () => {
  beforeEach(() => useSettingsLevelStore.setState({ level: "expert" }));
  afterEach(() => {
    cleanup();
    act(() => useSettingsLevelStore.setState({ level: null }));
  });

  it("has no save button: a switch writes the value it just set", () => {
    const { onSave } = renderSection();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "settings:autoUpdate.requireApproval" }));

    expect(onSave).toHaveBeenCalledWith({ ...SETTINGS, requireApproval: false });
  });

  it("writes a number when its field is left, not on every keystroke", () => {
    const { onSave, onSet } = renderSection();
    const field = screen.getByLabelText("settings:autoUpdate.expiryHours");

    fireEvent.change(field, { target: { value: "30" } });
    expect(onSet).toHaveBeenCalledWith({ ...SETTINGS, expiryHours: 30 });
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.blur(field);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("AutoUpdateSection — standard level: decisions stay, tuning waits", () => {
  beforeEach(() => useSettingsLevelStore.setState({ level: "standard" }));
  afterEach(() => {
    cleanup();
    act(() => useSettingsLevelStore.setState({ level: null }));
  });

  it("keeps approval at the standard level, hides expiry, and offers no inert interval / only-during-flight control (forgejo#389)", () => {
    renderSection();
    expect(
      screen.getByRole("switch", { name: "settings:autoUpdate.requireApproval" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "settings:autoUpdate.onlyDuringFlight" })
    ).toBeNull();
    expect(screen.queryByLabelText("settings:autoUpdate.checkInterval")).toBeNull();
    expect(screen.queryByLabelText("settings:autoUpdate.expiryHours")).toBeNull();
  });
});

describe("AutoUpdateSection — touch size follows the pointer (forgejo#321, iPad look)", () => {
  const original = window.matchMedia;
  const pointer = (coarse: boolean): void => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  };
  afterEach(() => {
    window.matchMedia = original;
  });

  it("gives the pending-updates link a 44 px target under a finger", () => {
    pointer(true);
    renderSection();
    const link = screen.getByRole("link", { name: /settings:autoUpdate.viewPending/ });
    expect(link.style.minHeight).toBe("var(--ts-size-touch-min)");
    expect(link.style.display).toBe("inline-flex");
  });

  it("stays an inline text link under a mouse", () => {
    pointer(false);
    renderSection();
    const link = screen.getByRole("link", { name: /settings:autoUpdate.viewPending/ });
    expect(link.style.minHeight).toBe("");
  });
});
