import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const coarse = vi.hoisted(() => ({ value: false }));
vi.mock("../../../hooks/useCoarsePointer", () => ({ useCoarsePointer: () => coarse.value }));

import { Switch } from "../Field";

const track = (): HTMLElement => document.querySelector("[data-switch-track]") as HTMLElement;

/**
 * Touch sizing follows the pointer, not the width (CLAUDE.md): the settings
 * prototype of forgejo#321 draws a 52×32 switch for a finger, and the web
 * drew 42×24 on every iPad.
 */
describe("Switch — size by pointer", () => {
  afterEach(() => {
    coarse.value = false;
  });

  it("keeps the compact 42×24 track for a mouse", () => {
    render(<Switch checked={false} onChange={() => {}} label="x" />);
    expect(track().style.width).toBe("42px");
    expect(track().style.height).toBe("24px");
  });

  it("draws the 52×32 track under a coarse pointer, whatever the width", () => {
    coarse.value = true;
    render(<Switch checked onChange={() => {}} label="x" />);
    expect(track().style.width).toBe("52px");
    expect(track().style.height).toBe("32px");
  });
});
