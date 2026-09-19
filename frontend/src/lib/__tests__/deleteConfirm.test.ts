/**
 * The rule that keeps a domain's list and its detail page saying the same
 * sentence. Six delete dialogs used to say six different things; four of them
 * never mentioned what goes with the record, and one never warned that it was
 * permanent at all.
 */
import { describe, it, expect, vi } from "vitest";
import { countedDeleteMessage, withDocumentNote } from "../deleteConfirm";

const KEYS = {
  counted: "cruise:detail.deleteConfirmMessage",
  empty: "cruise:detail.deleteConfirmMessageNoStops",
};

describe("countedDeleteMessage", () => {
  it("names the subject and the quantity that goes with it", () => {
    const t = vi.fn(() => "…");
    countedDeleteMessage(t, KEYS, "Icon of the Seas", 12);
    expect(t).toHaveBeenCalledWith(KEYS.counted, { name: "Icon of the Seas", count: 12 });
  });

  it("passes the count through so i18next can pick the singular", () => {
    const t = vi.fn(() => "…");
    countedDeleteMessage(t, KEYS, "AIDAluna", 1);
    expect(t).toHaveBeenCalledWith(KEYS.counted, { name: "AIDAluna", count: 1 });
  });

  it("drops the quantity entirely at zero — 'mit 0 Hafenanläufen' is noise", () => {
    const t = vi.fn(() => "…");
    countedDeleteMessage(t, KEYS, "Europa 2", 0);
    expect(t).toHaveBeenCalledWith(KEYS.empty, { name: "Europa 2" });
  });

  it("returns whatever the translator produced, unassembled", () => {
    // German sentences do not survive being glued from fragments, so this
    // helper only PICKS a key — it never builds prose.
    const t = vi.fn(() => "„Europa 2“ wird dauerhaft gelöscht.");
    expect(countedDeleteMessage(t, KEYS, "Europa 2", 0)).toBe(
      "„Europa 2“ wird dauerhaft gelöscht."
    );
  });
});

/**
 * Findings 3 and 6 of the write-path audit (2026-09-19): `Document` cascades
 * from flight, cruise, stay, place visit and trip — proven live against the
 * database by `backend/src/__tests__/integrity/cascades.integrity.test.ts` —
 * and not one of the five dialogs said so.
 */
describe("withDocumentNote", () => {
  it("appends the count as its own line", () => {
    const t = vi.fn(() => "Dazu 3 Dokumente, die mit gelöscht werden.");
    expect(withDocumentNote("Base.", t, 3)).toBe(
      "Base.\nDazu 3 Dokumente, die mit gelöscht werden."
    );
    expect(t).toHaveBeenCalledWith("documents:deleteCascadeNote", { count: 3 });
  });

  it("passes the count through so i18next can pick the singular", () => {
    const t = vi.fn(() => "…");
    withDocumentNote("Base.", t, 1);
    expect(t).toHaveBeenCalledWith("documents:deleteCascadeNote", { count: 1 });
  });

  it("says nothing at zero", () => {
    const t = vi.fn(() => "…");
    expect(withDocumentNote("Base.", t, 0)).toBe("Base.");
    expect(t).not.toHaveBeenCalled();
  });

  it("says nothing while the count is unknown — null is not none", () => {
    // The request is still out, or it failed. Either way the dialog shows its
    // base sentence and opens; it is never held back for a warning.
    const t = vi.fn(() => "…");
    expect(withDocumentNote("Base.", t, null)).toBe("Base.");
    expect(t).not.toHaveBeenCalled();
  });

  it("leaves a message that already carries its own note intact", () => {
    // The stay dialog appends the legacy receipt note first. Both lines stand.
    const t = vi.fn(() => "Dazu 1 Dokument, das mit gelöscht wird.");
    expect(withDocumentNote("Base.\nReceipt note.", t, 1)).toBe(
      "Base.\nReceipt note.\nDazu 1 Dokument, das mit gelöscht wird."
    );
  });
});
