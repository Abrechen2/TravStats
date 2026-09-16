import { test as setup, expect } from "@playwright/test";

import { STORAGE_STATE } from "./storageState";

/**
 * Sign in once, and hand the session to every spec that needs one.
 *
 * AUD-098: `flights.spec.ts` and `pendingUpdates.spec.ts` carried the comment
 * "These tests assume user is logged in / You may need to add authentication
 * setup here" and never did it. Their contexts were anonymous, every protected
 * page redirected to the login screen, and the assertions were written so that
 * a login screen satisfied them — 42 green browser cases that had not reached
 * the feature they named.
 *
 * This is the missing half. It also decides the suite's honesty: a run that
 * cannot sign in FAILS here, loudly and once, instead of reporting a screenful
 * of passes about screens nobody saw.
 */
const USERNAME = process.env.E2E_USERNAME ?? "admin";
const PASSWORD = process.env.E2E_PASSWORD ?? "admin123";

setup("authenticate", async ({ page }) => {
  await page.goto("/login");

  await page.fill("input#username", USERNAME);
  await page.fill("input#password", PASSWORD);
  await page.click('button[type="submit"]');

  // Landing anywhere that is not /login is the proof the session exists. A
  // wrong password leaves us here, and this is where the run should stop.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  // Dismiss the "what's new" dialog once, for everybody.
  //
  // It is a full-screen overlay that intercepts pointer events, so the first
  // click of every other spec lands on it instead of the control it wanted —
  // Playwright reports that as a timeout on an element it has already found,
  // which reads like flakiness and is not. The dismissal is stored SERVER-side
  // (`whatsNewSeenVersion` in user settings), so doing it here fixes it for
  // every case rather than for this session.
  //
  // Conditional on purpose, and legitimately so: this is environment
  // preparation, not an assertion. The dialog only appears after a version
  // change, and a run where it is absent is not a failure.
  // WAIT for it rather than asking whether it is there right now: the dialog
  // renders only after the settings request comes back, so an instantaneous
  // `isVisible()` answers "no" and silently does nothing — which is precisely
  // the conditional-that-does-not-run pattern this whole rewrite is about, and
  // it caught me here first.
  const dismiss = page.getByRole("button", { name: /Verstanden|Got it/i });
  const appeared = await dismiss
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await dismiss.click();
    await expect(dismiss).toBeHidden({ timeout: 10_000 });
  }

  await page.context().storageState({ path: STORAGE_STATE });
});
