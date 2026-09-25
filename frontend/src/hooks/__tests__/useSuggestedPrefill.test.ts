import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { useSuggestedPrefill } from "../useSuggestedPrefill";

// The hook with a real piece of state behind it, the way a form holds a field.
function setup(suggestion: string | null, initial = "") {
  return renderHook(
    ({ suggestion: s }: { suggestion: string | null }) => {
      const [value, setValue] = useState(initial);
      const suggested = useSuggestedPrefill(s, value, setValue);
      return { value, setValue, suggested };
    },
    { initialProps: { suggestion } }
  );
}

describe("useSuggestedPrefill", () => {
  it("fills an empty field and says it did", () => {
    const { result } = setup("992000111");
    expect(result.current.value).toBe("992000111");
    expect(result.current.suggested).toBe(true);
  });

  it("never overwrites a value that was already there", () => {
    const { result } = setup("992000111", "MY-OWN");
    expect(result.current.value).toBe("MY-OWN");
    expect(result.current.suggested).toBe(false);
  });

  it("replaces its own fill when the suggestion changes", () => {
    const { result, rerender } = setup("LH-NUMBER");
    rerender({ suggestion: "LX-NUMBER" });
    expect(result.current.value).toBe("LX-NUMBER");
  });

  it("clears its own fill when the new airline has nothing to offer", () => {
    const { result, rerender } = setup("LH-NUMBER");
    rerender({ suggestion: null });
    expect(result.current.value).toBe("");
    expect(result.current.suggested).toBe(false);
  });

  it("leaves a value the user typed over its fill alone", () => {
    const { result, rerender } = setup("LH-NUMBER");
    act(() => result.current.setValue("TYPED"));
    expect(result.current.suggested).toBe(false);
    rerender({ suggestion: "LX-NUMBER" });
    expect(result.current.value).toBe("TYPED");
  });

  it("waits for a suggestion to arrive", () => {
    const { result, rerender } = setup(null);
    expect(result.current.value).toBe("");
    rerender({ suggestion: "992000111" });
    expect(result.current.value).toBe("992000111");
  });
});
