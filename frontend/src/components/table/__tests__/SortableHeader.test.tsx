/**
 * The shared sort header — and the arrow direction the domain tables have to
 * agree on.
 *
 * Two of the three list pages built this button by hand and showed the
 * OPPOSITE arrow: ascending was ▼ on flights and cruises, ▲ here. Someone
 * moving between the pages saw the same sort state with a reversed sign, and
 * on the flights page the arrow even contradicted its own footer, which wrote
 * "aufsteigend" beside a ▼. ▲ for ascending is the convention (A→Z and
 * early→late point up), so the shared component keeps it and the two hand-made
 * copies are replaced by it.
 *
 * The active column is also marked here rather than by each page: colour plus
 * an underline, the clearest of the three markings that existed.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortableHeader } from "../SortableHeader";

function renderHeader(props: Partial<Parameters<typeof SortableHeader>[0]> = {}) {
  const onSort = vi.fn();
  render(
    <SortableHeader
      column="name"
      sortBy="name"
      sortOrder="asc"
      onSort={onSort}
      ariaLabel="Nach Name sortieren"
      {...props}
    >
      Name
    </SortableHeader>
  );
  return { onSort };
}

describe("SortableHeader", () => {
  it("points UP for ascending", () => {
    renderHeader({ sortOrder: "asc" });
    expect(screen.getByRole("button").textContent).toContain("▲");
  });

  it("points DOWN for descending", () => {
    renderHeader({ sortOrder: "desc" });
    expect(screen.getByRole("button").textContent).toContain("▼");
  });

  it("keeps the arrow's space on an inactive column, so the header cannot jump", () => {
    // Hiding the arrow entirely made the flights header shift sideways every
    // time the sort column changed.
    renderHeader({ sortBy: "other" });
    const arrow = screen.getByRole("button").querySelector("span");
    expect(arrow).not.toBeNull();
    expect(arrow!.className).toContain("opacity-0");
  });

  it("marks the active column with the accent colour and an underline", () => {
    renderHeader({ sortBy: "name" });
    const style = screen.getByRole("button").getAttribute("style") ?? "";
    expect(style).toContain("var(--accent)");
    expect(style).toContain("border-bottom");
  });

  it("leaves an inactive column unmarked", () => {
    renderHeader({ sortBy: "other" });
    const style = screen.getByRole("button").getAttribute("style") ?? "";
    expect(style).not.toContain("border-bottom");
  });

  it("carries a label for screen readers", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: "Nach Name sortieren" })).toBeInTheDocument();
  });

  it("reports its own column when clicked", async () => {
    const { onSort } = renderHeader({ column: "chain", sortBy: "name" });
    await userEvent.click(screen.getByRole("button"));
    expect(onSort).toHaveBeenCalledWith("chain");
  });
});
