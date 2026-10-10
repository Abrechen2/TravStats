import { test as setup, expect } from "@playwright/test";

import { STORAGE_STATE } from "./storageState";
import { confirmProfileZone } from "./support/profileZone";

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
  // Up to three first-login dialogs are prepared below, two of them with a
  // bounded wait for a dialog that may legitimately never come. Together they
  // outgrow the 30 s default — which then fails inside whichever step happens
  // to be running, and reads like a broken dialog rather than a full budget.
  setup.setTimeout(90_000);

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
  // Scoped to a dialog and anchored: the globe's coachmark carries a
  // "Verstanden, los geht's" button too, and an unanchored match clicked THAT
  // — sometimes while the usage-statistics dialog below already covered it,
  // which timed the whole setup out on an intercepted click.
  const dismiss = page.getByRole("dialog").getByRole("button", { name: /^(Verstanden|Got it)$/ });
  const appeared = await dismiss
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await dismiss.click();
    await expect(dismiss).toBeHidden({ timeout: 10_000 });
  }

  // Since 2026-09-20 the instance-wide usage-statistics question is its own
  // step, shown to an administrator once the release notes are gone (owner
  // ruling: it used to sit inside that dialog and was dismissed with it). On a
  // fresh CI database nobody has answered it, so it is the next full-screen
  // overlay in line — the first CI run after the merge failed eleven specs with
  // the same 'element found, click timed out' signature the block above names.
  // Answering 'no' here is persisted instance-wide (PUT /admin/usage-stats), so
  // it fixes every spec, including the ones that log in with a fresh context.
  const decline = page.getByRole("button", { name: /Nein, danke|No, thanks/i });
  const asked = await decline
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (asked) {
    await decline.click();
    await expect(decline).toBeHidden({ timeout: 10_000 });
  }

  // Third in line since 2026-09-27: an account without a profile zone is asked
  // for one (ADR 0002 Q1), in a modal that waits until the two dialogs above
  // are gone. The seeded admin has none, so on a fresh CI database it covered
  // every page — the 'element found, click timed out' signature once more,
  // this time with "Vorschlag von deinem Gerät" named as the interceptor.
  // Not a waited-for maybe: the server says whether the account has a zone,
  // and when it has none the dialog MUST appear.
  const settings = await page.request.get("/api/v1/settings");
  expect(settings.ok()).toBe(true);
  const { profileZone } = (await settings.json()) as {
    profileZone?: { hasProfileZone?: boolean };
  };
  if (profileZone?.hasProfileZone !== true) await confirmProfileZone(page);

  await page.context().storageState({ path: STORAGE_STATE });
});
