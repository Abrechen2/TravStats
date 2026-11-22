import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const coarse = vi.hoisted(() => ({ on: false }));
vi.mock("../../../hooks/useCoarsePointer", () => ({ useCoarsePointer: () => coarse.on }));

import OverflowMenu from "../OverflowMenu";

const onA = vi.fn();
const onDelete = vi.fn();

function renderMenu(props: Partial<Parameters<typeof OverflowMenu>[0]> = {}) {
  return render(
    <MemoryRouter>
      <button type="button">before</button>
      <OverflowMenu
        label="More"
        triggerLabel="Mehr"
        testId="menu"
        entries={[
          { key: "del", label: "Delete", danger: true, onSelect: onDelete },
          { key: "a", label: "Alpha", onSelect: onA },
          { key: "b", label: "Beta", onSelect: vi.fn() },
        ]}
        {...props}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  coarse.on = false;
});

describe("OverflowMenu", () => {
  it("opens on click and lists every entry as a menuitem", () => {
    renderMenu();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByTestId("menu"));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Alpha",
      "Beta",
      "Delete",
    ]);
  });

  it("sorts a destructive entry last and draws it red, whatever order it was given in", () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("menu"));
    const items = screen.getAllByRole("menuitem");
    expect(items[items.length - 1]?.textContent).toBe("Delete");
    expect(items[items.length - 1]?.style.color).toBe("var(--ts-bad)");
  });

  it("moves with the arrow keys, wraps, and Home/End jump", () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("menu"));
    const menu = screen.getByRole("menu");
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items[2]);
  });

  it("closes on Escape and hands focus back to the trigger", () => {
    renderMenu();
    const trigger = screen.getByTestId("menu");
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("runs the chosen entry once and closes the menu", () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Alpha" }));
    expect(onA).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("asks before a destructive entry that carries a confirm, and only then runs it", () => {
    renderMenu({
      entries: [
        {
          key: "del",
          label: "Delete",
          danger: true,
          confirm: { title: "Really?", message: "Gone for good." },
          onSelect: onDelete,
        },
      ],
    });
    fireEvent.click(screen.getByTestId("menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Gone for good.")).toBeTruthy();
    const dialog = screen.getByTestId("confirm-modal");
    const cancel = Array.from(dialog.querySelectorAll("button")).find(
      (b) => !b.classList.contains("btn-danger") && b.className.includes("border-border")
    );
    fireEvent.click(cancel!);
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByTestId("confirm-modal").querySelector("button.btn-danger")!);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("skips a disabled entry on the arrows and shows why it is disabled", () => {
    renderMenu({
      entries: [
        { key: "a", label: "Alpha", onSelect: onA },
        { key: "b", label: "Beta", disabled: true, disabledReason: "Needs a key" },
        { key: "c", label: "Gamma", onSelect: vi.fn() },
      ],
    });
    fireEvent.click(screen.getByTestId("menu"));
    expect(screen.getByText("Needs a key")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Gamma");
  });

  it("sizes the trigger and rows for a finger on a coarse pointer", () => {
    coarse.on = true;
    renderMenu({ triggerLabel: undefined });
    const trigger = screen.getByTestId("menu");
    expect(trigger.style.width).toBe("44px");
    fireEvent.click(trigger);
    expect(screen.getAllByRole("menuitem")[0]?.style.minHeight).toBe("var(--ts-size-touch-min)");
  });

  it("renders nothing when every entry is absent", () => {
    renderMenu({ entries: [] });
    expect(screen.queryByTestId("menu")).toBeNull();
  });

  it("keeps a click inside a clickable row from reaching the row", () => {
    const rowClick = vi.fn();
    render(
      <MemoryRouter>
        <div onClick={rowClick}>
          <OverflowMenu
            label="Row"
            testId="row-menu"
            stopPropagation
            entries={[{ key: "a", label: "Alpha", onSelect: onA }]}
          />
        </div>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId("row-menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Alpha" }));
    expect(onA).toHaveBeenCalled();
    expect(rowClick).not.toHaveBeenCalled();
  });
});
