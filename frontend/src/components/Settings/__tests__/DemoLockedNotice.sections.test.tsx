import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Both sections fetch on mount through real API modules; the frontend test
// setup fails any request that escapes a mock (forgejo#110), so both modules
// each section actually imports must be mocked here — copied from
// ApiTokensSection.test.tsx and PasskeySection.test.tsx.
const tokensApi = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
const passkeyApiMock = vi.hoisted(() => ({
  availability: vi.fn(),
  list: vi.fn(),
  registerOptions: vi.fn(),
  registerVerify: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}));
// A mutable box rather than a plain boolean: the mock factory below closes
// over it once, at module-mock time, so flipping `.current` per test is the
// only way to change what useIsDemoAccount() returns between cases.
const isDemoMock = vi.hoisted(() => ({ current: true }));

const notificationsApiMock = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
}));

vi.mock("../PassportRow", () => ({ default: () => null })); // its own tests
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight"], isEnabled: () => true }),
}));
vi.mock("../../../lib/api/tokens", () => ({ apiTokensApi: tokensApi }));
vi.mock("../../../lib/api", () => ({
  passkeyApi: passkeyApiMock,
  notificationsApi: notificationsApiMock,
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({
  useIsDemoAccount: () => isDemoMock.current,
}));

import { useSettingsStore } from "../../../store/settingsStore";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { resetWriteQueue } from "../../ui/settings/writeQueue";
import ApiTokensSection from "../ApiTokensSection";
import PasskeySection from "../PasskeySection";
import NotificationsSection from "../NotificationsSection";
import ProfileSection from "../ProfileSection";
import DisplaySection from "../DisplaySection";
import UnitsSection from "../UnitsSection";

// Each case's locked control: the button the section offers a normal
// account, and which the demo account must never see.
const CASES = [
  ["ApiTokensSection", ApiTokensSection, "settings:apiTokens.create", "settings:blocks.lock.demo"],
  ["PasskeySection", PasskeySection, "settings:passkeys.add", "settings:blocks.lock.demo"],
] as const;

// The server refuses these for the shared demo account (403
// DEMO_ACCOUNT_FORBIDDEN). Offering the button anyway would be a button that
// always fails; the section says why instead.
describe("settings sections on the demo account", () => {
  beforeEach(() => {
    isDemoMock.current = true;
    tokensApi.list.mockReset().mockResolvedValue([]);
    tokensApi.create.mockReset();
    tokensApi.revoke.mockReset();
    passkeyApiMock.availability.mockReset().mockResolvedValue({ available: true, reason: null });
    passkeyApiMock.list.mockReset().mockResolvedValue([]);
    passkeyApiMock.registerOptions.mockReset();
    passkeyApiMock.registerVerify.mockReset();
    passkeyApiMock.remove.mockReset();
    notificationsApiMock.getPreferences.mockReset().mockResolvedValue({
      notificationEmail: null,
      notifyBefore24h: false,
      notifyBefore2h: false,
      domains: Object.fromEntries(
        ["flight", "cruise", "rail", "bus", "ferry", "lodging", "rental", "roadtrip", "poi"].map(
          (d) => [d, { enabled: false, leadHours: [], channel: "both" }]
        )
      ),
      mail: { available: true, reason: null },
      push: { available: true, reason: null },
    });
    notificationsApiMock.updatePreferences.mockReset();
  });

  it.each(CASES)(
    "%s explains instead of offering the action",
    async (_name, Section, controlName, notice) => {
      render(
        <MemoryRouter>
          <Section />
        </MemoryRouter>
      );
      expect(await screen.findByText(notice)).toBeInTheDocument();
      // The notice and the control are mutually exclusive branches — a
      // regression rendering both would still pass on the assertion above
      // alone, so the control's absence is checked explicitly too.
      expect(screen.queryByRole("button", { name: controlName })).not.toBeInTheDocument();
    }
  );

  // Proves the test cannot pass vacuously (e.g. from a wrong/renamed control
  // key): for a normal account the control IS offered and the notice is NOT.
  it.each(CASES)(
    "%s offers the action instead of the notice for a normal account",
    async (_name, Section, controlName) => {
      isDemoMock.current = false;
      render(
        <MemoryRouter>
          <Section />
        </MemoryRouter>
      );
      expect(await screen.findByRole("button", { name: controlName })).toBeInTheDocument();
      expect(screen.queryByText("settings:demoLocked")).not.toBeInTheDocument();
    }
  );
});

/**
 * The notification address is not a preference on this account: whoever writes
 * it can ask /auth/forgot-password for a reset link to their own inbox and
 * lock every other visitor out (finding C3). The server refuses the write, so
 * the section says so instead of offering a field that silently fails.
 */
describe("NotificationsSection on the demo account", () => {
  beforeEach(() => {
    isDemoMock.current = true;
    notificationsApiMock.getPreferences.mockReset().mockResolvedValue({
      notificationEmail: null,
      notifyBefore24h: false,
      notifyBefore2h: false,
      domains: Object.fromEntries(
        ["flight", "cruise", "rail", "bus", "ferry", "lodging", "rental", "roadtrip", "poi"].map(
          (d) => [d, { enabled: false, leadHours: [], channel: "both" }]
        )
      ),
      mail: { available: true, reason: null },
      push: { available: true, reason: null },
    });
    notificationsApiMock.updatePreferences.mockReset();
  });

  it("shows the reminder controls locked, with the reason, instead of offering a write that always fails", async () => {
    render(
      <MemoryRouter>
        <NotificationsSection />
      </MemoryRouter>
    );
    const leads = await screen.findAllByRole("combobox");
    for (const lead of leads) {
      expect(lead).toBeDisabled();
      expect(lead).toHaveAttribute("aria-disabled", "true");
    }
    expect(screen.getAllByText("settings:blocks.lock.demo").length).toBeGreaterThan(0);
    // Read-only is fine for the shared account; a write never leaves the page.
    expect(notificationsApiMock.updatePreferences).not.toHaveBeenCalled();
  });

  it("offers them for a normal account — the case above is not vacuous", async () => {
    isDemoMock.current = false;
    render(
      <MemoryRouter>
        <NotificationsSection />
      </MemoryRouter>
    );
    for (const lead of await screen.findAllByRole("combobox")) expect(lead).toBeEnabled();
    expect(screen.queryByText("settings:blocks.lock.demo")).not.toBeInTheDocument();
  });
});

/**
 * Finding I1: the name and the birthdate were left editable while the picture
 * was locked. The name greets every visitor from the header, the birthdate
 * drives an achievement, and both survived the nightly reseed.
 */
describe("ProfileSection on the demo account", () => {
  beforeEach(() => {
    useSettingsLevelStore.setState({ level: "expert" });
  });
  const profile = {
    username: "demo",
    email: "",
    firstName: null,
    lastName: null,
    birthdate: null,
  };
  const renderProfile = (): void => {
    render(
      <ProfileSection
        profile={profile}
        uploadingProfilePicture={false}
        removingProfilePicture={false}
        onAvatarUpload={() => {}}
        onAvatarDelete={() => {}}
      />
    );
  };

  it("shows the name, e-mail and birthday fields locked, each with the reason", () => {
    isDemoMock.current = true;
    renderProfile();
    for (const label of ["firstName", "lastName", "birthdate", "email"]) {
      expect(screen.getByLabelText(`settings:profile.${label}`)).toBeDisabled();
    }
    expect(screen.getAllByText("settings:blocks.lock.demo").length).toBeGreaterThanOrEqual(4);
    // The username is shown for everybody: a visitor still needs to see which
    // account they are looking at.
    expect(screen.getAllByText("@demo").length).toBeGreaterThan(0);
  });

  it("offers them for a normal account — the case above is not vacuous", () => {
    isDemoMock.current = false;
    renderProfile();
    expect(screen.getByLabelText("settings:profile.firstName")).toBeEnabled();
    expect(screen.getByLabelText("settings:profile.birthdate")).toBeEnabled();
    expect(screen.queryByText("settings:blocks.lock.demo")).not.toBeInTheDocument();
  });
});

/**
 * Beta audit 2026-09-19, unlisted finding 1: the display and units cards were
 * the two that said NOTHING. Every control was live, the PUT came back 403,
 * the toast said "Speichern fehlgeschlagen" -- and the change was applied
 * locally and survived a reload. The store rolls it back now; these cards say
 * beforehand that it will not stick.
 */
describe("the display and units cards on the demo account", () => {
  const display = {
    language: "de" as const,
    timezone: "Europe/Berlin",
    dateFormat: "DD.MM.YYYY" as const,
    timeFormat: "24h" as const,
    theme: "dark" as const,
  };
  const units = { distanceUnit: "kilometers" as const, weightUnit: "kg" as const, currency: "EUR" };

  const renderDisplay = (): void => {
    render(<DisplaySection display={display} />);
  };
  const renderUnits = (): void => {
    render(<UnitsSection units={units} baseCurrency="EUR" />);
  };

  it("says the display settings are locked, and disables them", () => {
    isDemoMock.current = true;
    renderDisplay();
    expect(screen.getAllByText("settings:blocks.lock.demo").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("settings:rows.timezone.name")).toBeDisabled();
    expect(
      screen.getByRole("radiogroup", { name: "settings:rows.dateFormat.name" })
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("says the units are locked, and disables them", () => {
    isDemoMock.current = true;
    renderUnits();
    expect(screen.getAllByText("settings:blocks.lock.demo").length).toBeGreaterThan(0);
    expect(screen.getByRole("radiogroup", { name: "settings:rows.distance.name" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });

  it("leaves both cards alone for a normal account -- the cases above are not vacuous", () => {
    isDemoMock.current = false;
    renderDisplay();
    renderUnits();
    expect(screen.queryByText("settings:blocks.lock.demo")).not.toBeInTheDocument();
    expect(screen.getByLabelText("settings:rows.timezone.name")).toBeEnabled();
  });
});

/** forgejo#186: the unit a bare baggage-allowance number is read in. */
describe("the weight unit on the units card", () => {
  const renderWith = (units: Record<string, unknown>): void => {
    isDemoMock.current = false;
    render(<UnitsSection units={units as never} baseCurrency="EUR" />);
  };

  it("offers kilograms and pounds and saves the chosen one", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    // The suite's global store mock is a plain object: give it the two actions.
    const setUnits = vi.fn();
    Object.assign(useSettingsStore.getState(), { setUnits, saveRemoteSettings: save });
    renderWith({ distanceUnit: "kilometers", weightUnit: "kg" });
    const group = screen.getByRole("radiogroup", { name: "settings:rows.weight.name" });
    const radios = Array.from(group.querySelectorAll('[role="radio"]'));
    expect(radios.map((radio) => radio.textContent)).toEqual(["kg", "lb"]);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");

    fireEvent.click(radios[1]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(setUnits).toHaveBeenCalledWith({ weightUnit: "lb" });
    expect(save).toHaveBeenCalledTimes(1);
    act(() => resetWriteQueue());
    vi.useRealTimers();
  });

  it("shows kilograms for settings saved before the preference existed", () => {
    renderWith({ distanceUnit: "kilometers" });
    const group = screen.getByRole("radiogroup", { name: "settings:rows.weight.name" });
    expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe("kg");
  });
});
