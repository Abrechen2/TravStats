/**
 * The rule that keeps a domain's list and its detail page saying the same
 * sentence. Six delete dialogs used to say six different things; four of them
 * never mentioned what goes with the record, and one never warned that it was
 * permanent at all.
 */
import { describe, it, expect, vi } from "vitest";
import { countedDeleteMessage } from "../deleteConfirm";

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
