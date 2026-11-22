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
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import FlightRowActions from "../FlightRowActions";
import type { Flight } from "../../types";

const flight = { id: "f1" } as Flight;

function renderInRow() {
  const onRow = vi.fn();
  const handlers = { onEdit: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn() };
  render(
    <MemoryRouter>
      <div onClick={onRow}>
        <FlightRowActions flight={flight} {...handlers} />
      </div>
    </MemoryRouter>
  );
  return { onRow, ...handlers };
}

async function choose(name: string): Promise<void> {
  await userEvent.click(screen.getByTestId("flight-menu-f1"));
  await userEvent.click(screen.getByRole("menuitem", { name }));
}

describe("FlightRowActions", () => {
  it("is one ⋯ in the column — never visible words or three icons", () => {
    renderInRow();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText("common:buttons.edit")).not.toBeInTheDocument();
  });

  it("deletes without also opening the flight", async () => {
    const { onRow, onDelete } = renderInRow();
    await choose("common:buttons.delete");
    expect(onDelete).toHaveBeenCalledWith("f1");
    expect(onRow).not.toHaveBeenCalled();
  });

  it("edits without letting the click reach the row", async () => {
    const { onRow, onEdit } = renderInRow();
    await choose("common:buttons.edit");
    expect(onEdit).toHaveBeenCalledWith(flight);
    expect(onRow).not.toHaveBeenCalled();
  });

  it("offers both duplicate variants and keeps their clicks from reaching the row", async () => {
    const { onRow, onDuplicate } = renderInRow();
    await choose("flights:table.duplicate.return");
    expect(onDuplicate).toHaveBeenCalledWith(flight, "return");
    await choose("flights:table.duplicate.same");
    expect(onDuplicate).toHaveBeenCalledWith(flight, "same");
    expect(onRow).not.toHaveBeenCalled();
  });

  it("draws delete last, so it never sits where a duplicate click lands", async () => {
    renderInRow();
    await userEvent.click(screen.getByTestId("flight-menu-f1"));
    const items = screen.getAllByRole("menuitem");
    expect(items[items.length - 1]).toHaveTextContent("common:buttons.delete");
  });
});
