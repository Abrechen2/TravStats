import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TableScroll from "../TableScroll";
import StatCard, { STAT_CARD_CLASS } from "../../Stats/StatCard";

// jsdom does no layout, so these pin the STRUCTURE the layout fixes rest on:
// a table that sits in its own scroll region, and a stat card that may shrink
// below its longest word and wraps what does not fit (forgejo#290, #291).
describe("narrow-screen building blocks", () => {
  it("puts a table in a named, keyboard-reachable scroll region", () => {
    render(
      <>
        <h3 id="t">Titel</h3>
        <TableScroll labelledBy="t">
          <table>
            <tbody>
              <tr>
                <td>x</td>
              </tr>
            </tbody>
          </table>
        </TableScroll>
      </>
    );
    const region = screen.getByRole("region", { name: "Titel" });
    expect(region).toHaveClass("overflow-x-auto", "max-w-full");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.querySelector("table")).not.toBeNull();
  });

  it("lets a stat card shrink and wrap a long figure", () => {
    for (const cls of ["min-w-0", "break-words"]) expect(STAT_CARD_CLASS.split(" ")).toContain(cls);
    render(<StatCard title="Ø Bewertung" value="Keine Bewertung" description="" valueSize="md" />);
    expect(screen.getByText("Keine Bewertung").closest("div")).toHaveClass(
      "min-w-0",
      "break-words"
    );
  });
});
