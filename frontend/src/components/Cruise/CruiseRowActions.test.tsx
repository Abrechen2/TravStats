import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import CruiseRowActions from "./CruiseRowActions";
import type { Cruise } from "../../types";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const cruise = { id: "c1" } as Cruise;

describe("CruiseRowActions", () => {
  it("fires the matching callback per button and stops row propagation", async () => {
    const onEdit = vi.fn();
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    const onRow = vi.fn();
    render(
      <MemoryRouter>
        <table>
          <tbody>
            <tr onClick={onRow}>
              <td>
                <CruiseRowActions
                  cruise={cruise}
                  onEdit={onEdit}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </MemoryRouter>
    );
    for (const name of ["common:buttons.edit", "cruise:list.duplicate", "common:buttons.delete"]) {
      await userEvent.click(screen.getByTestId("cruise-menu-c1"));
      await userEvent.click(screen.getByRole("menuitem", { name }));
    }
    expect(onEdit).toHaveBeenCalledWith(cruise);
    expect(onDuplicate).toHaveBeenCalledWith(cruise);
    expect(onDelete).toHaveBeenCalledWith("c1");
    expect(onRow).not.toHaveBeenCalled(); // stopPropagation
  });
});
