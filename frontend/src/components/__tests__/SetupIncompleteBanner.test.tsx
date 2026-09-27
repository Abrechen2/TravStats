import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import deCommon from "../../i18n/resources/de/common.json";
import enCommon from "../../i18n/resources/en/common.json";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import SetupIncompleteBanner, {
  SETUP_INCOMPLETE_BANNER_KEY_PREFIX,
} from "../SetupIncompleteBanner";
import { useAuthStore } from "../../store/authStore";

type AuthState = Parameters<typeof useAuthStore.setState>[0];

function signIn(id: string): void {
  useAuthStore.setState({
    user: { id, username: "demo", isAdmin: false, isSharedDemo: true },
  } as AuthState);
}

function renderBanner(
  props: Partial<{ sessionConfirmed: boolean; requiresSetup: boolean | null }> = {}
) {
  return render(
    <MemoryRouter>
      <SetupIncompleteBanner sessionConfirmed requiresSetup {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  signIn("u-demo");
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  cleanup();
});

describe("SetupIncompleteBanner", () => {
  it("tells an authenticated session, while setup is still required, that the instance is not set up", () => {
    renderBanner();
    expect(screen.getByText("common:setupIncompleteBanner.message")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "common:setupIncompleteBanner.link" })).toHaveAttribute(
      "href",
      "/setup"
    );
  });

  it("stays silent while the session is not confirmed yet", () => {
    renderBanner({ sessionConfirmed: false });
    expect(screen.queryByText("common:setupIncompleteBanner.message")).not.toBeInTheDocument();
  });

  it("stays silent once setup is complete", () => {
    renderBanner({ requiresSetup: false });
    expect(screen.queryByText("common:setupIncompleteBanner.message")).not.toBeInTheDocument();
  });

  it("stays silent while requiresSetup is still unknown", () => {
    renderBanner({ requiresSetup: null });
    expect(screen.queryByText("common:setupIncompleteBanner.message")).not.toBeInTheDocument();
  });

  it("can be dismissed for the rest of the session", async () => {
    const user = userEvent.setup();
    renderBanner();
    await user.click(screen.getByRole("button", { name: "common:buttons.close" }));
    expect(screen.queryByText("common:setupIncompleteBanner.message")).not.toBeInTheDocument();
    expect(
      window.sessionStorage.getItem(`${SETUP_INCOMPLETE_BANNER_KEY_PREFIX}u-demo`)
    ).not.toBeNull();

    // A reload, or the app remounting after navigation, is the same session.
    cleanup();
    renderBanner();
    expect(screen.queryByText("common:setupIncompleteBanner.message")).not.toBeInTheDocument();
  });

  it("has its copy in German and English", () => {
    for (const common of [deCommon, enCommon]) {
      expect(common.setupIncompleteBanner?.message).toBeTruthy();
      expect(common.setupIncompleteBanner?.link).toBeTruthy();
    }
  });
});
