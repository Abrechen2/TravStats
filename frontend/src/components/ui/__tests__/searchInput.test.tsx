import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SearchInput } from "../SearchInput";

function Harness({ debounceMs, onChange }: { debounceMs?: number; onChange: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <SearchInput
      label="Suche"
      value={value}
      debounceMs={debounceMs}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("SearchInput", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is a searchbox with an accessible name, and offers a clear button only once there is text", () => {
    render(<Harness onChange={() => {}} />);
    const box = screen.getByRole("searchbox", { name: "Suche" });
    expect(screen.queryByRole("button", { name: "common:ui.clearSearch" })).toBeNull();
    fireEvent.change(box, { target: { value: "Rom" } });
    fireEvent.click(screen.getByRole("button", { name: "common:ui.clearSearch" }));
    expect((box as HTMLInputElement).value).toBe("");
  });

  it("holds the callback back while typing and fires it once typing pauses", () => {
    const onChange = vi.fn();
    render(<Harness debounceMs={300} onChange={onChange} />);
    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "L" } });
    fireEvent.change(box, { target: { value: "Lu" } });
    expect((box as HTMLInputElement).value).toBe("Lu");
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("Lu");
  });

  it("clears at once, without waiting for the debounce", () => {
    const onChange = vi.fn();
    render(<Harness debounceMs={300} onChange={onChange} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "common:ui.clearSearch" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});

describe("SearchInput when it cannot be edited", () => {
  it("offers no clear button on a disabled box, so the clear cannot change what the box would not let you type", () => {
    render(<SearchInput label="Suche" value="Rom" onChange={() => {}} disabled />);
    expect(screen.queryByRole("button", { name: "common:ui.clearSearch" })).toBeNull();
  });
});
