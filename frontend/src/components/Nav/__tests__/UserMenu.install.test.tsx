import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "de" },
  }),
}));

import UserMenu from "../UserMenu";
import { resetInstallPrompt } from "../../../lib/installPrompt";

afterEach(() => {
  cleanup();
  resetInstallPrompt();
});

const user = { username: "akuenzel", firstName: "Alex", lastName: "Künzel" };

const openMenu = (): void => {
  render(
    <MemoryRouter>
      <UserMenu user={user} onLogout={vi.fn()} />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole("button"));
};

/** What Chromium fires: an ordinary Event carrying `prompt`. */
function fireInstallOffer(prompt: () => Promise<void>): void {
  const event = new Event("beforeinstallprompt") as Event & { prompt: () => Promise<void> };
  event.prompt = prompt;
  act(() => {
    window.dispatchEvent(event);
  });
}

/**
 * Auditor 3, 2026-09-19: TravStats ships a manifest and a service worker, so a
 * Chromium browser fires `beforeinstallprompt` — and then hides its own
 * install affordance behind a menu the average reader never opens. The app
 * said nothing at all, and the event is the only handle on that offer.
 */
describe("UserMenu — installing the app", () => {
  it("offers nothing where the browser has not offered", () => {
    openMenu();
    expect(
      screen.queryByRole("menuitem", { name: "dashboard:installApp" })
    ).not.toBeInTheDocument();
  });

  it("offers the entry once the browser has, and calls the browser's own prompt", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    openMenu();
    fireInstallOffer(prompt);

    fireEvent.click(await screen.findByRole("menuitem", { name: "dashboard:installApp" }));

    expect(prompt).toHaveBeenCalledTimes(1);
  });

  /**
   * One event, one prompt — a second `prompt()` on the same event rejects,
   * and the browser fires a fresh event if the reader dismisses it and
   * becomes eligible again.
   */
  it("takes the entry away again once the offer has been spent", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    openMenu();
    fireInstallOffer(prompt);

    fireEvent.click(await screen.findByRole("menuitem", { name: "dashboard:installApp" }));
    // Clicking a menu item closes the menu; reopen it, and assert it really
    // IS open before concluding anything from an absent entry.
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(screen.getByRole("menuitem", { name: "dashboard:logout" })).toBeInTheDocument();

    expect(
      screen.queryByRole("menuitem", { name: "dashboard:installApp" })
    ).not.toBeInTheDocument();
  });
});

/**
 * Review, 2026-09-19: the listener lived in the menu's own effect, so the
 * entry appeared only when the menu happened to mount before the browser
 * fired. `beforeinstallprompt` fires once and early — on a cold load it is
 * long gone by the time anyone opens the account menu. It is caught at module
 * scope now (`lib/installPrompt.ts`, imported from `main.tsx`).
 */
describe("UserMenu — an offer made before anything mounted", () => {
  it("still has the entry when the browser offered first", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    // No component on screen yet: exactly the cold-load order.
    fireInstallOffer(prompt);

    openMenu();

    fireEvent.click(await screen.findByRole("menuitem", { name: "dashboard:installApp" }));
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
