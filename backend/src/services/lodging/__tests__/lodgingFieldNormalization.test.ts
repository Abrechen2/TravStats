import { describe, it, expect } from "@jest/globals";
import {
  cleanText,
  normalizeBoard,
  normalizeGuestCount,
} from "../lodgingFieldNormalization";

/**
 * Measured over 640 real hotel confirmations from the owner's archive:
 * 61 % state the board, 47 % a per-night rate, 42 % the occupancy. The
 * extraction contract asked for none of them, so all three were thrown away on
 * every single import — while `board`, `pricePerNight` and `companions` sat
 * there as columns, and the 2.6.0 statistics compute "price by board" from a
 * field nothing ever filled.
 */

describe("cleanText", () => {
  it("rejects the STRING 'null' a language model likes to emit", () => {
    // Measured twice on the Armani confirmation: country came back as the four
    // characters n-u-l-l. The display resolver rejects those, so nobody saw it
    // — and it was stored anyway. A row with country "null" is not the same as
    // a row without a country.
    expect(cleanText("null")).toBeNull();
    expect(cleanText("NULL")).toBeNull();
    expect(cleanText("undefined")).toBeNull();
    expect(cleanText("N/A")).toBeNull();
    expect(cleanText("-")).toBeNull();
    expect(cleanText("   ")).toBeNull();
  });

  it("keeps a real value, trimmed", () => {
    expect(cleanText("  Dubai ")).toBe("Dubai");
  });

  it("does not swallow a legitimate value that merely contains 'null'", () => {
    expect(cleanText("Nullarbor Roadhouse")).toBe("Nullarbor Roadhouse");
  });

  it("passes through non-strings as null", () => {
    expect(cleanText(42)).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });
});

describe("normalizeBoard", () => {
  it("reads the German words a confirmation actually prints", () => {
    expect(normalizeBoard("Frühstück")).toBe("breakfast");
    expect(normalizeBoard("inkl. Frühstück")).toBe("breakfast");
    expect(normalizeBoard("Halbpension")).toBe("half");
    expect(normalizeBoard("Vollpension")).toBe("full");
    expect(normalizeBoard("All Inclusive")).toBe("all_inclusive");
    expect(normalizeBoard("ohne Verpflegung")).toBe("none");
  });

  it("reads the English ones too", () => {
    expect(normalizeBoard("Breakfast included")).toBe("breakfast");
    expect(normalizeBoard("Bed and Breakfast")).toBe("breakfast");
    expect(normalizeBoard("Half Board")).toBe("half");
    expect(normalizeBoard("Full Board")).toBe("full");
    expect(normalizeBoard("Room only")).toBe("none");
  });

  it("does not let 'board' in 'half board' fall through to a bare match", () => {
    // Order matters: every board phrase contains the word "board", and
    // "all-inclusive" contains neither "half" nor "full". Checking the specific
    // phrases before the generic ones is what keeps these apart.
    expect(normalizeBoard("half board")).toBe("half");
    expect(normalizeBoard("full board")).toBe("full");
  });

  it("accepts a value that is already the enum", () => {
    expect(normalizeBoard("all_inclusive")).toBe("all_inclusive");
    expect(normalizeBoard("breakfast")).toBe("breakfast");
  });

  it("returns null rather than guessing", () => {
    expect(normalizeBoard("Deluxe Room")).toBeNull();
    expect(normalizeBoard("null")).toBeNull();
    expect(normalizeBoard(null)).toBeNull();
    expect(normalizeBoard(7)).toBeNull();
  });
});

describe("normalizeGuestCount", () => {
  it("adds adults and children", () => {
    expect(normalizeGuestCount(2, 0)).toBe(2);
    expect(normalizeGuestCount(2, 1)).toBe(3);
  });

  it("treats a missing children count as none, not as unknown", () => {
    expect(normalizeGuestCount(2, null)).toBe(2);
  });

  it("is null when no adult count was found — 0 guests is not a stay", () => {
    expect(normalizeGuestCount(null, null)).toBeNull();
    expect(normalizeGuestCount(0, 0)).toBeNull();
  });

  it("ignores nonsense rather than storing it", () => {
    expect(normalizeGuestCount(-1, 0)).toBeNull();
    expect(normalizeGuestCount(999, 0)).toBeNull();
    expect(normalizeGuestCount("zwei", null)).toBeNull();
  });
});
