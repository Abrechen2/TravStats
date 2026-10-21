import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Segmented } from "../Segmented";

const OPTIONS = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
] as const;

describe("Segmented", () => {
  it("is a named radio group with exactly one checked radio and one tab stop", () => {
    render(<Segmented label="Sprache" value="en" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Sprache" })).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("chooses on click", () => {
    const onChange = vi.fn();
    render(<Segmented label="Sprache" value="de" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Français" }));
    expect(onChange).toHaveBeenCalledWith("fr");
  });

  it("moves the choice with the arrow keys and wraps at both ends", () => {
    const onChange = vi.fn();
    render(<Segmented label="Sprache" value="de" options={OPTIONS} onChange={onChange} />);
    const first = screen.getByRole("radio", { name: "Deutsch" });
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("fr");
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("en");
    fireEvent.keyDown(first, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("names a symbol pill by its spoken name", () => {
    render(
      <Segmented
        label="Distanz"
        value="km"
        options={[{ value: "km", label: "km", name: "Kilometer" }]}
        onChange={() => {}}
      />
    );
    expect(screen.getByRole("radio", { name: "Kilometer" })).toBeTruthy();
  });
});

describe("Segmented — touch size follows the pointer (forgejo#321, iPad look)", () => {
  const pointer = (coarse: boolean): void => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  };
  const draw = (): HTMLElement[] => {
    render(
      <Segmented
        label="Ansicht"
        value="a"
        onChange={vi.fn()}
        options={[
          { value: "a", label: "Standard" },
          { value: "b", label: "Experte" },
        ]}
      />
    );
    return screen.getAllByRole("radio");
  };

  it("gives a finger a 44 px target", () => {
    pointer(true);
    for (const pill of draw()) expect(pill.style.minHeight).toBe("var(--ts-size-touch-min)");
  });

  it("stays compact under a mouse", () => {
    pointer(false);
    for (const pill of draw()) expect(pill.style.height).toBe("36px");
  });
});
