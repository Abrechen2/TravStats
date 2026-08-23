/**
 * The flight row navigates. These buttons sit inside it, so every one of them
 * has to swallow its click.
 *
 * This is a regression test with a story: when the row became clickable, this
 * component still drew its own icon buttons instead of the shared ones, and
 * none of them stopped propagation — clicking "löschen" opened the flight it
 * was about to delete. The unit suite was entirely green while that shipped,
 * because nothing asserted what the click did to the row UNDERNEATH.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FlightRowActions from "../FlightRowActions";
import type { Flight } from "../../types";

const flight = { id: "f1" } as Flight;

function renderInRow(openMenuFor: string | null = null) {
  const onRow = vi.fn();
  const handlers = {
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onToggleDuplicateMenu: vi.fn(),
  };
  render(
    <div onClick={onRow}>
      <FlightRowActions
        flight={flight}
        openDuplicateMenuFor={openMenuFor}
        {...handlers}
      />
    </div>
  );
  return { onRow, ...handlers };
}

describe("FlightRowActions", () => {
  it("stays icons-with-labels — never visible words in the column", () => {
    renderInRow();
    expect(screen.getByLabelText("common:buttons.edit")).toBeInTheDocument();
    expect(screen.getByLabelText("flights:table.duplicate.label")).toBeInTheDocument();
    expect(screen.getByLabelText("common:buttons.delete")).toBeInTheDocument();
    // The actions column is the narrowest thing on the widest table; three
    // words here cost more than they explain, and the tooltip carries them.
    expect(screen.queryByText("common:buttons.edit")).not.toBeInTheDocument();
  });

  it("deletes without also opening the flight", async () => {
    const { onRow, onDelete } = renderInRow();
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.delete" }));
    expect(onDelete).toHaveBeenCalledWith("f1");
    expect(onRow).not.toHaveBeenCalled();
  });

  it("edits without letting the click reach the row twice", async () => {
    const { onRow, onEdit } = renderInRow();
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.edit" }));
    expect(onEdit).toHaveBeenCalledWith(flight);
    expect(onRow).not.toHaveBeenCalled();
  });

  it("opens the duplicate menu without opening the flight", async () => {
    const { onRow, onToggleDuplicateMenu } = renderInRow();
    await userEvent.click(
      screen.getByRole("button", { name: "flights:table.duplicate.label" })
    );
    expect(onToggleDuplicateMenu).toHaveBeenCalledWith("f1");
    expect(onRow).not.toHaveBeenCalled();
  });

  it("keeps the menu's own entries from reaching the row", async () => {
    const { onRow, onDuplicate } = renderInRow("f1");
    await userEvent.click(screen.getByText("flights:table.duplicate.return"));
    expect(onDuplicate).toHaveBeenCalledWith(flight, "return");
    expect(onRow).not.toHaveBeenCalled();
  });
});
