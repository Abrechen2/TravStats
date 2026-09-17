import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

vi.mock("../../../lib/api/tokens", () => ({ apiTokensApi: tokensApi }));
vi.mock("../../../lib/api", () => ({ passkeyApi: passkeyApiMock }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({
  useIsDemoAccount: () => isDemoMock.current,
}));

import ApiTokensSection from "../ApiTokensSection";
import PasskeySection from "../PasskeySection";

// Each case's locked control: the button the section offers a normal
// account, and which the demo account must never see.
const CASES = [
  ["ApiTokensSection", ApiTokensSection, "settings:apiTokens.create"],
  ["PasskeySection", PasskeySection, "settings:passkeys.add"],
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
  });

  it.each(CASES)(
    "%s explains instead of offering the action",
    async (_name, Section, controlName) => {
      render(
        <MemoryRouter>
          <Section />
        </MemoryRouter>
      );
      expect(await screen.findByText("settings:demoLocked")).toBeInTheDocument();
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
