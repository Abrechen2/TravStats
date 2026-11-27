import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PURPOSE_ICONS } from "../../../shared/purposeCatalogue";
import { PurposeIconPicker } from "../PurposeIconPicker";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

describe("PurposeIconPicker", () => {
  it("offers a grid of icon buttons instead of a select that lists icon names as text", () => {
    const onChange = vi.fn();
    const { container } = render(<PurposeIconPicker value="heart" onChange={onChange} />);
    expect(container.querySelector("select")).toBeNull();
    fireEvent.click(screen.getByTestId("purpose-icon-trigger"));
    const grid = screen.getByRole("group", { name: "Symbol" });
    const buttons = grid.querySelectorAll("button");
    expect(buttons).toHaveLength(PURPOSE_ICONS.length);
    for (const b of buttons) expect(b.querySelector("svg")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Kamera" }));
    expect(onChange).toHaveBeenCalledWith("camera");
    expect(screen.queryByRole("group", { name: "Symbol" })).toBeNull();
  });
});
