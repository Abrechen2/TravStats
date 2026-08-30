import { describe, it, expect } from "vitest";

import de from "../../../../i18n/resources/de/flights.json";
import en from "../../../../i18n/resources/en/flights.json";

/**
 * Creating a flight must not say it was updated.
 *
 * Forgejo #11: the manual "Flug hinzufügen" flow answered a successful CREATE
 * with "Flug aktualisiert". The record was correct; the sentence was not — and
 * it tells someone they edited a row that already existed, which is exactly the
 * fear a person has when they are unsure whether an import ran twice.
 *
 * Three call sites shared the one key. Two of them only ever create; the third
 * (the special-flight modal) does both and now reads which state is open —
 * before that state is cleared, or it would always report a create.
 *
 * WHAT THIS TEST DOES NOT COVER, deliberately stated rather than implied: it
 * does not render those call sites. `FlightsTab` and `FlightsTablePage` pull in
 * deck.gl, the map stores and the whole dashboard shell, and standing that up
 * to observe one toast constant would cost more than it protects. What is
 * pinned here is the part that can rot on its own — the two messages existing,
 * differing, and being present in both languages. A call site regressing to the
 * wrong constant is caught by review, not by this file.
 */
type Toasts = { table: { toast: Record<string, string> } };

const deToasts = (de as Toasts).table.toast;
const enToasts = (en as Toasts).table.toast;

describe("flight save messages", () => {
  it("has a create message that is not the update message", () => {
    // If these ever converge, distinguishing them at the call sites becomes a
    // no-op and the fix is cosmetic again.
    expect(deToasts.created).toBeTruthy();
    expect(deToasts.updated).toBeTruthy();
    expect(deToasts.created).not.toBe(deToasts.updated);
  });

  it("mirrors both messages into English", () => {
    // German is the primary locale. A missing English key falls back to German
    // silently — the failure mode from the badge copy earlier today.
    expect(enToasts.created).toBeTruthy();
    expect(enToasts.updated).toBeTruthy();
    expect(enToasts.created).not.toBe(enToasts.updated);
  });

  it("words each one as the action it reports", () => {
    expect(deToasts.created).toMatch(/angelegt|erstellt|hinzugefügt/i);
    expect(deToasts.updated).toMatch(/aktualisiert|geändert/i);
    expect(enToasts.created).toMatch(/creat|added/i);
    expect(enToasts.updated).toMatch(/updat/i);
  });
});
