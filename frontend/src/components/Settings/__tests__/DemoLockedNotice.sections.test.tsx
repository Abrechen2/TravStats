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

vi.mock("../../../lib/api/tokens", () => ({ apiTokensApi: tokensApi }));
vi.mock("../../../lib/api", () => ({ passkeyApi: passkeyApiMock }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => true }));

import ApiTokensSection from "../ApiTokensSection";
import PasskeySection from "../PasskeySection";

// The server refuses these for the shared demo account (403
// DEMO_ACCOUNT_FORBIDDEN). Offering the button anyway would be a button that
// always fails; the section says why instead.
describe("settings sections on the demo account", () => {
  beforeEach(() => {
    tokensApi.list.mockReset().mockResolvedValue([]);
    tokensApi.create.mockReset();
    tokensApi.revoke.mockReset();
    passkeyApiMock.availability.mockReset().mockResolvedValue({ available: true, reason: null });
    passkeyApiMock.list.mockReset().mockResolvedValue([]);
    passkeyApiMock.registerOptions.mockReset();
    passkeyApiMock.registerVerify.mockReset();
    passkeyApiMock.remove.mockReset();
  });

  it.each([
    ["ApiTokensSection", ApiTokensSection],
    ["PasskeySection", PasskeySection],
  ])("%s explains instead of offering the action", async (_name, Section) => {
    render(
      <MemoryRouter>
        <Section />
      </MemoryRouter>
    );
    expect(await screen.findByText("settings:demoLocked")).toBeInTheDocument();
  });
});
