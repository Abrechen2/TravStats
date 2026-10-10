import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The zone every E2E account confirms. Fixed rather than the runner's own
 * zone, so "today", "planned or past" and countdowns answer the same on a
 * developer machine and on a UTC CI runner. Berlin because the seeded demo
 * account's home airport is MUC.
 */
export const E2E_PROFILE_ZONE = "Europe/Berlin";

/** The "Deine Zeitzone" dialog an account without a profile zone meets at login. */
export function profileZoneDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: /Deine Zeitzone|Your time zone/i });
}

/**
 * Answer the profile-zone question the way a user does: pick a zone, confirm.
 *
 * Since 2026-09-27 (ADR 0002 Q1) an account without a profile zone is asked
 * for one once it is signed in, in a modal that sits over every page. The
 * answer is written server-side, so answering it once stops it for every later
 * session of that account. "Later" would only defer it for one browser
 * session, and storageState does not carry sessionStorage — every spec would
 * meet the dialog again.
 */
export async function confirmProfileZone(page: Page): Promise<void> {
  const dialog = profileZoneDialog(page);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog
    .getByRole("combobox", { name: /Vorschlag von deinem Gerät|Suggested by your device/i })
    .selectOption(E2E_PROFILE_ZONE);
  await dialog.getByRole("button", { name: /^Übernehmen$|^Use this zone$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}
