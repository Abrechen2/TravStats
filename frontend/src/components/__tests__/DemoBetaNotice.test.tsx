import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import deCommon from "../../i18n/resources/de/common.json";
import enCommon from "../../i18n/resources/en/common.json";
import deAdmin from "../../i18n/resources/de/admin.json";
import enAdmin from "../../i18n/resources/en/admin.json";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// The suite-wide settingsStore mock (__tests__/setup.ts) is read-only, so the
// instance flag is driven through the hook the component reads it from.
const beta = vi.hoisted(() => ({ enabled: true as boolean | null }));
vi.mock("../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    betaFeaturesEnabled: beta.enabled,
    isFeatureVisible: () => beta.enabled === true,
  }),
}));

import DemoBetaNotice, { DEMO_BETA_NOTICE_KEY_PREFIX } from "../DemoBetaNotice";
import { useAuthStore } from "../../store/authStore";
import { BETA_FEATURE_KEYS } from "../../config/betaFeatures";

type AuthState = Parameters<typeof useAuthStore.setState>[0];

function signIn(isSharedDemo: boolean): void {
  useAuthStore.setState({
    user: { id: "u-demo", username: isSharedDemo ? "demo" : "anna", isAdmin: false, isSharedDemo },
  } as AuthState);
}

function setBeta(enabled: boolean | null): void {
  beta.enabled = enabled;
}

function renderNotice(
  props: Partial<{
    sessionConfirmed: boolean;
    whatsNewChecked: boolean;
    whatsNewOpen: boolean;
  }> = {}
) {
  return render(
    <DemoBetaNotice sessionConfirmed whatsNewChecked whatsNewOpen={false} {...props} />
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  signIn(true);
  setBeta(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("DemoBetaNotice", () => {
  it("tells the shared demo account that beta features are on, naming them from the registry", () => {
    renderNotice();
    expect(screen.getByRole("dialog")).toHaveTextContent("common:demoBetaNotice.title");
    expect(screen.getByText("common:demoBetaNotice.body")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(
      BETA_FEATURE_KEYS.map((key) => `admin:instance.fields.betaFeatures.features.${key}.name`)
    );
  });

  it("stays silent for an ordinary account", () => {
    signIn(false);
    renderNotice();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays silent for the demo account when an admin switched beta off", () => {
    setBeta(false);
    renderNotice();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays silent while the beta flag has not loaded yet", () => {
    setBeta(null);
    renderNotice();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("waits until the session is confirmed and the what's-new dialog is out of the way", () => {
    const { rerender } = renderNotice({ sessionConfirmed: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<DemoBetaNotice sessionConfirmed whatsNewChecked={false} whatsNewOpen={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<DemoBetaNotice sessionConfirmed whatsNewChecked whatsNewOpen />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<DemoBetaNotice sessionConfirmed whatsNewChecked whatsNewOpen={false} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("is shown only once per session", async () => {
    const user = userEvent.setup();
    renderNotice();
    await user.click(screen.getByRole("button", { name: "common:demoBetaNotice.dismiss" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(`${DEMO_BETA_NOTICE_KEY_PREFIX}u-demo`)).not.toBeNull();

    // A reload, or the app remounting after navigation, is the same session.
    cleanup();
    renderNotice();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("still renders when sessionStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage is disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError: storage is disabled");
    });
    renderNotice();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("has its copy in German and English, and a name for every registered beta feature", () => {
    for (const common of [deCommon, enCommon]) {
      const notice = (common as unknown as Record<string, Record<string, string>>).demoBetaNotice;
      for (const field of ["title", "body", "listTitle", "dismiss"]) {
        expect(notice?.[field], field).toBeTruthy();
      }
    }
    for (const admin of [deAdmin, enAdmin]) {
      const features = (
        admin as unknown as {
          instance: {
            fields: { betaFeatures: { features: Record<string, { name?: string }> } };
          };
        }
      ).instance.fields.betaFeatures.features;
      for (const key of BETA_FEATURE_KEYS) {
        expect(features[key]?.name, key).toBeTruthy();
      }
    }
  });
});
