import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DataJumpList, DATA_PART_ANCHOR } from "../DataJumpList";

describe("DataJumpList", () => {
  it("offers Sicherung, Mitnehmen and Einlesen as jumps on the long data page, each scrolling to its card", () => {
    const scrolls: string[] = [];
    for (const id of Object.values(DATA_PART_ANCHOR)) {
      const el = document.createElement("div");
      el.id = id;
      el.tabIndex = -1;
      el.scrollIntoView = vi.fn(() => scrolls.push(id));
      document.body.appendChild(el);
    }
    render(<DataJumpList />);
    const links = screen.getByTestId("data-jump-list").querySelectorAll("a");
    expect([...links].map((a) => a.textContent)).toEqual([
      "settingsRows:data.sections.backup",
      "settingsRows:data.sections.export",
      "settingsRows:data.sections.import",
    ]);
    fireEvent.click(links[2]);
    expect(scrolls).toEqual([DATA_PART_ANCHOR.import]);
  });
});
