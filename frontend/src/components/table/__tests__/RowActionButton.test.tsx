/**
 * The row actions have to stop propagation: since the rows navigate, a delete
 * click that bubbled would open the entry it just removed.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RowActionButton, RowActions } from "../RowActionButton";

describe("RowActionButton", () => {
  it("calls its handler", async () => {
    const onClick = vi.fn();
    render(<RowActionButton icon="edit" label="Bearbeiten" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not let the click reach the row underneath", async () => {
    const onRow = vi.fn();
    const onDelete = vi.fn();
    render(
      <div onClick={onRow}>
        <RowActionButton icon="delete" label="Löschen" onClick={onDelete} />
      </div>
    );
    await userEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  it("carries a name and a tooltip, because an icon alone is a guess", () => {
    render(<RowActionButton icon="duplicate" label="Duplizieren" onClick={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Duplizieren" });
    expect(btn).toHaveAttribute("title", "Duplizieren");
  });

  it("hides the glyph from assistive tech, which reads the label instead", () => {
    const { container } = render(
      <RowActionButton icon="edit" label="Bearbeiten" onClick={vi.fn()} />
    );
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("groups actions to the right", () => {
    const { container } = render(
      <RowActions>
        <RowActionButton icon="edit" label="Bearbeiten" onClick={vi.fn()} />
      </RowActions>
    );
    expect(container.firstElementChild?.className).toContain("justify-end");
  });
});
