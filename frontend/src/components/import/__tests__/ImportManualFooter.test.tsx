import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportManualFooter } from "../ImportRouteList";

describe("ImportManualFooter", () => {
  it("calls back when the link is chosen", async () => {
    const onSelect = vi.fn();
    render(<ImportManualFooter label="Von Hand eingeben" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "Von Hand eingeben" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  // forgejo#249: "Nichts davon - von Hand eingeben" measured 191 x 16 px on an
  // iPad. A quiet link stays quiet for a mouse and reaches the touch minimum
  // for a finger (class = contract; jsdom cannot measure).
  it("is at least the touch minimum high on a coarse pointer", () => {
    render(<ImportManualFooter label="Von Hand eingeben" onSelect={vi.fn()} />);
    const classes = screen.getByRole("button").className;
    expect(classes).toContain("pointer-coarse:min-h-(--ts-size-touch-min)");
    expect(classes).toContain("pointer-coarse:items-center");
  });
});
