import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import RowMenu from "../RowMenu";
import ListHeaderMenu from "../ListHeaderMenu";

describe("RowMenu", () => {
  it("keeps a click on the menu and on its entries from opening the row underneath", () => {
    const onRow = vi.fn();
    const onDelete = vi.fn();
    render(
      <MemoryRouter>
        <div onClick={onRow}>
          <RowMenu
            testId="row-menu"
            entries={[{ key: "delete", label: "Delete", danger: true, onSelect: onDelete }]}
          />
        </div>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId("row-menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onRow).not.toHaveBeenCalled();
  });
});

describe("ListHeaderMenu", () => {
  it("offers bulk selection only while not selecting, and the import hub as a link", () => {
    const start = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <ListHeaderMenu selection={{ selecting: false, start }} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId("list-header-menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: "bulkEdit:start" }));
    expect(start).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("list-header-menu"));
    expect(screen.getByRole("menuitem", { name: "common:buttons.import" })).toHaveAttribute(
      "href",
      "/settings/daten#import"
    );
    rerender(
      <MemoryRouter>
        <ListHeaderMenu selection={{ selecting: true, start }} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId("list-header-menu"));
    expect(screen.queryByRole("menuitem", { name: "bulkEdit:start" })).toBeNull();
  });
});
