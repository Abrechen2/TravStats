import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LodgingStatusTag } from "../LodgingStatusTag";
import type { Lodging } from "../../../types/lodging";

const unlocated = {
  id: "l1",
  name: "Hotel Adlon",
  address: "Unter den Linden 77",
  city: "Berlin",
  country: "DE",
  lat: null,
  lon: null,
} as unknown as Lodging;

describe("LodgingStatusTag", () => {
  // forgejo#249: the explanation of an issue was a hover-only `title`.
  it("carries the explanation as text a screen reader gets, not only as a hover title", () => {
    render(<LodgingStatusTag lodging={{ ...unlocated, lat: 1, lon: 2, address: null }} />);
    expect(screen.getByText("lodging:list.status.noAddressHint")).toHaveClass("sr-only");
  });

  it("the repair button is described by the explanation", () => {
    render(<LodgingStatusTag lodging={unlocated} onRepair={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAccessibleDescription(
      "lodging:list.status.unlocatedHint"
    );
  });

  // forgejo#249: the sr-only text is for screen readers; a sighted finger needs
  // something it can tap.
  it("offers the explanation to a tap: a help button opens it, and the row does not", async () => {
    const onRow = vi.fn();
    const onRowKey = vi.fn();
    render(
      <div onClick={onRow} onKeyDown={onRowKey}>
        <LodgingStatusTag lodging={{ ...unlocated, lat: 1, lon: 2, address: null }} />
      </div>
    );
    const help = screen.getByRole("button", { name: "help.about" });
    await userEvent.click(help);

    // Visible now: a second copy of the hint, in the opened help (the first is sr-only).
    const copies = await screen.findAllByText("lodging:list.status.noAddressHint");
    expect(copies.some((el) => !el.classList.contains("sr-only"))).toBe(true);
    expect(onRow).not.toHaveBeenCalled();

    help.focus();
    await userEvent.keyboard("{Enter}");
    expect(onRowKey).not.toHaveBeenCalled();
  });

  it("the repair button needs no extra help button - its description is the hint", () => {
    render(<LodgingStatusTag lodging={unlocated} onRepair={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "help.about" })).toBeNull();
  });

  // forgejo#249: the help icon is 16 x 16 px. Its hit area grows to 44 px on a
  // coarse pointer inside the shared Toggletip; jsdom cannot measure.
  it("gives the help icon a hit area sized by the pointer", () => {
    render(<LodgingStatusTag lodging={{ ...unlocated, lat: 1, lon: 2, address: null }} />);
    const help = screen.getByRole("button", { name: "help.about" });
    expect(help.querySelector("[data-toggletip-hit]")).not.toBeNull();
  });
});
